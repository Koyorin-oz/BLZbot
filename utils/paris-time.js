const TIME_ZONE = "Europe/Paris";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getParisDateParts(timestamp = Date.now()) {
  const parts = formatter.formatToParts(new Date(timestamp));
  const value = (type) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function parisDateKey(timestamp = Date.now()) {
  const { year, month, day } = getParisDateParts(timestamp);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parisLocalTimeToTimestamp(
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let timestamp = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = getParisDateParts(timestamp);
    const observedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const correction = targetAsUtc - observedAsUtc;
    if (correction === 0) break;
    timestamp += correction;
  }

  return timestamp;
}

function parisDayStartMs(timestamp = Date.now()) {
  const { year, month, day } = getParisDateParts(timestamp);
  return parisLocalTimeToTimestamp(year, month, day);
}

function parisPreviousDayStartMs(timestamp = Date.now()) {
  const { year, month, day } = getParisDateParts(timestamp);
  const previousDay = new Date(Date.UTC(year, month - 1, day - 1));
  return parisLocalTimeToTimestamp(
    previousDay.getUTCFullYear(),
    previousDay.getUTCMonth() + 1,
    previousDay.getUTCDate(),
  );
}

function parisNextMidnightMs(timestamp = Date.now()) {
  const { year, month, day } = getParisDateParts(timestamp);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return parisLocalTimeToTimestamp(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
  );
}

function parisWeekKey(timestamp = Date.now()) {
  const { year, month, day } = getParisDateParts(timestamp);
  const date = new Date(Date.UTC(year, month - 1, day));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function isSameParisDay(firstTimestamp, secondTimestamp = Date.now()) {
  return parisDateKey(firstTimestamp) === parisDateKey(secondTimestamp);
}

module.exports = {
  TIME_ZONE,
  getParisDateParts,
  parisDateKey,
  parisDayStartMs,
  parisPreviousDayStartMs,
  parisNextMidnightMs,
  parisWeekKey,
  isSameParisDay,
};
