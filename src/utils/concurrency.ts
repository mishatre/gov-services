
import pLimit from 'p-limit';

export async function runConcurrently<T>(items: T[], concurrencyLimit: number = 10, predicate: (item: T, index: number, array: T[]) => Promise<any>) {
    const limit = pLimit(concurrencyLimit);
    await Promise.all(items.map((...args) => limit(() => predicate(...args))));
}