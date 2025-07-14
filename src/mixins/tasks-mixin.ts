
import { service, method, stopped, action, created, dset } from "moldecor";
import { Context, Service } from "moleculer";
import assert from "node:assert";
import { AsyncLocalStorage } from 'node:async_hooks';

export enum TaskStatus {
    IDLE = 'IDLE',
    RUNNING = 'RUNNING',
    ERROR = 'ERROR',
    ABORTED = 'ABORTED',
    DONE = 'DONE'
}

interface TaskSchema {
    name?: string;
    // hooks?: {
    //     before?: string,
    //     beforeStart?: string;
    //     after?: string
    // }
}

export function withTask<T>(value: T) {
    assert(value instanceof Task, `Expected decorated method to return Task<T>, got ${typeof value}`);
    return value as Task<T> | undefined;
}

export function task<
    P extends TaskSchema,
    S,
    T extends (...args: any[]) => any,
>(params?: P) {
    return function (handler: T, context: ClassMethodDecoratorContext<S, T>) {
        assert(
            context.kind === 'method',
            'Task decorator can be used only as class method decorator',
        );

        dset(context.metadata, ['methods', context.name], function(this: S & TasksMixin, ...args: any[]) {
            const task = this.createTask(context.name, handler.bind(this, ...args));
            task?.run();
            return task;
        });

    };
}

const contextSymbol = Symbol('taskContext');

function isAbortError(error: any): boolean {
    return error?.name === 'AbortError' ||
           error?.code === 'ABORT_ERR' ||
           error?.constructor?.name === 'AbortError';
}

export class Task<T> {
    #controller: AbortController;
    #context: AsyncLocalStorage<Task<T>>;
    #fn: (...args: any[]) => Promise<T>;
    #started = false;

    public progress = '';
    public status = TaskStatus.IDLE;
    public running = false;
    public startedAt: Date | undefined;

    public promise?: Promise<T>;

    constructor(public name: string | symbol, context: AsyncLocalStorage<Task<T>>, fn: (...args: any[]) => Promise<T>) {
        this.#controller = new AbortController();
        this.#context = context;
        this.#fn = fn;
    }

    async #task(): Promise<T> {

        this.status = TaskStatus.RUNNING;
        this.startedAt = new Date();
        this.running = true;

        let result;
        try {
            result = await this.#fn();
        } catch(error) {
            this.running = false;
            if (isAbortError(error)) {
                this.status = TaskStatus.ABORTED;    
            } else {
                this.status = TaskStatus.ERROR;
            }
            throw error;
        }

        this.status = TaskStatus.DONE;
        this.running = false;

        return result;

    }

    public run() {
        if (this.#started) {
            throw new Error("Cannot restart already running/finished task");
        }
        this.#started = true;
        return this.promise = this.#context.run<Promise<T>>(this, this.#task.bind(this));
    }

    public get signal() {
        return this.#controller.signal;
    }
    
    public abort(reason?: any) {
        this.#controller.abort(reason);
    }

    public setProgress(progress: any) {
        this.progress = progress;
    }
}

@service({
    name: 'tasks'
})
export default class TasksMixin extends Service {

    declare tasks: Map<string | symbol, Task<any>>;
    declare private [contextSymbol]: AsyncLocalStorage<Task<any>>;

    @action({
        name: 'getRunningTasks'
    })
    public getRunningTasks(_: Context) {
        return [...this.tasks].map(([_, {name, status, progress, running, startedAt}]) => ({
            name, 
            status, 
            progress,
            running, 
            startedAt
        }));
    }

    @method 
    public hasRunningTask(name: string) {
        return this.tasks.get(name)?.running || false;
    }

    @method
    public getCurrentTask(): Task<any> | undefined {
        return this[contextSymbol].getStore();
    }

    @method 
    public createTask(name: string | symbol, fn: () => Promise<any>) {

        const foundTask = this.tasks.get(name);
        if (!!foundTask) {
            if (foundTask.running === true) {
                return undefined;
            } else {
                this.tasks.delete(name);
            }
        }

        const task = new Task(name, this[contextSymbol], fn);
        this.tasks.set(name, task);

        return task;

    }

    @created
    public created() {
        this.tasks = new Map();
        this[contextSymbol] = new AsyncLocalStorage<Task<any>>();
    }

    @stopped
    public async stopped() {
        await Promise.allSettled([...this.tasks.values()]
            .filter(task => task.running)
            .map((task) => {
                task.abort();
                return task.promise;
            })
        );
    }

}