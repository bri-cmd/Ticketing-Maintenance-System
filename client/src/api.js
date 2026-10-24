export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) return null;
  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error(`The server returned an invalid response (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.message || "The request could not be completed.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export function jsonBody(value) {
  return JSON.stringify(value);
}
