const LEVELS = Object.freeze({ DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 });

export function createLogger(levelName = 'INFO') {
  const threshold = LEVELS[levelName] ?? LEVELS.INFO;

  function write(level, args) {
    if (LEVELS[level] < threshold) return;
    const prefix = `${new Date().toISOString()} ${level}`;
    const method = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    method(prefix, ...args);
  }

  return {
    debug: (...args) => write('DEBUG', args),
    info: (...args) => write('INFO', args),
    warn: (...args) => write('WARN', args),
    error: (...args) => write('ERROR', args),
  };
}
