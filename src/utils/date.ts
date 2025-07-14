import { Temporal } from "@js-temporal/polyfill";

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
    const [day, month, year] = dateString.split('.').map(Number);
    return new Date(year, month - 1, day);
}

export function fromReverseShortDate(dateString: string) {
    const year = Number(dateString.slice(0, 4));
    const month = Number(dateString.slice(4, 6));
    const day = Number(dateString.slice(6, 8));
    return new Date(year, month - 1, day);
}

export function getStartOfDayUTCInTimezone(timezone: string) {
    // Get the current date/time in the specified timezone
    const zonedDateTime = Temporal.Now.zonedDateTimeISO(timezone);
    // Get the start of that day (i.e. midnight in that timezone)
    const startOfDayInZone = zonedDateTime.startOfDay();
    // Convert that local midnight to an Instant (a UTC point in time)
    const instantUTC = startOfDayInZone.toInstant();
    return instantUTC.toString({ fractionalSecondDigits: 3 }); // ISO string in UTC
}

export function getLastSaturday(fromDate = new Date()) {
    const date = new Date(fromDate);
    // getDay(): 0 = Sunday, 6 = Saturday
    const day = date.getDay();
    const diff = (day === 6) ? 0 : day + 1;
    date.setDate(date.getDate() - diff);
    date.setHours(0, 0, 0, 0); // optional: reset time to midnight
    return date;
}