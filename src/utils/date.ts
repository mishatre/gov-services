export function addDays(date: Date, days: number) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

export function makeShortDate(date: Date) {
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

export function getMinutesBetweenDates(date1: Date, date2: Date) {
    const diff = date2.getTime() - date1.getTime();
    return diff / 60000;
}

export function combineDateTimeString(date: string, time: string) {
    const [day, month, year] = date.split('.').map(Number);
    const [hours, minutes, seconds] = time.split('.').map(Number);
    return new Date(year, month - 1, day, hours, minutes, seconds);
}

export function fromShortDate(dateString: string) {
    const [day, month, year] = dateString.split('.');
    return new Date(`${year}-${month}-${day}`);
}
