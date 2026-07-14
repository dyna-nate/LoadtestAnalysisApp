const PREFIX = "[dt-neoload]";

// Enable debug output at runtime: localStorage.setItem('dt-neoload:debug', 'true')
// Disable:                         localStorage.removeItem('dt-neoload:debug')
function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem("dt-neoload:debug") === "true";
  } catch {
    return false;
  }
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDebugEnabled()) console.log(PREFIX, ...args);
  },
  info: (...args: unknown[]) => console.info(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
};
