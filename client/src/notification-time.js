const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const timeUnits = [
  ["year", 31536000000],
  ["month", 2592000000],
  ["week", 604800000],
  ["day", 86400000],
  ["hour", 3600000],
  ["minute", 60000],
  ["second", 1000],
];

export function formatNotificationTime(value) {
  if (value === null || value === undefined || value === "") {
    return { relative: "Time unavailable", full: "" };
  }

  const date = new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) {
    return { relative: "Time unavailable", full: "" };
  }

  const difference = timestamp - Date.now();
  const absoluteDifference = Math.abs(difference);
  const [unit, unitLength] = timeUnits.find(([, length]) => absoluteDifference >= length)
    || timeUnits[timeUnits.length - 1];

  return {
    relative: relativeFormatter.format(Math.round(difference / unitLength), unit),
    full: dateFormatter.format(date),
  };
}
