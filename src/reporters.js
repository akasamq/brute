import chalk from 'chalk';
import { table } from 'table';
import { formatMs, formatBytes } from './utils.js';

const pass = chalk.green('✔');
const fail = chalk.red('✘');
const dim = chalk.dim;

const statusIcon = (passed) => (passed ? pass : fail);

const headerLine = (title) =>
  console.log(
    '\n' + chalk.bold.cyan(`── ${title} `) + chalk.dim('─'.repeat(Math.max(0, 60 - title.length)))
  );

// Helper to build formatted table using the table library
const buildTable = (headers, rows, colWidths) => {
  const config = {
    columns: headers.map((_, i) => ({
      width: colWidths[i],
      wrapWord: true,
      alignment: i === 0 ? 'left' : 'center',
    })),
    border: {
      topBody: '─',
      topJoin: '┬',
      topLeft: '┌',
      topRight: '┐',
      bottomBody: '─',
      bottomJoin: '┴',
      bottomLeft: '└',
      bottomRight: '┘',
      bodyLeft: '│',
      bodyRight: '│',
      bodyJoin: '│',
      joinBody: '─',
      joinLeft: '├',
      joinRight: '┤',
      joinJoin: '┼',
    },
  };

  return table([headers, ...rows], config);
};

/**
 * Print a summary of all protocol test results.
 * @param {string} url  broker URL
 * @param {Array<{name:string, passed:boolean, error?:string, durationMs:number}>} results
 */
export const printProtocolReport = (url, results) => {
  headerLine(`Protocol Test — ${url}`);

  const headers = [
    chalk.white('Test'),
    chalk.white('Result'),
    chalk.white('Duration'),
    chalk.white('Detail'),
  ];
  const colWidths = [38, 10, 12, 42];

  const rows = results.map((r) => [
    r.name,
    statusIcon(r.passed) + ' ' + (r.passed ? chalk.green('PASS') : chalk.red('FAIL')),
    dim(formatMs(r.durationMs)),
    r.passed ? dim('ok') : chalk.red(r.error ?? ''),
  ]);

  console.log(buildTable(headers, rows, colWidths));

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const color = passed === total ? chalk.green : passed > 0 ? chalk.yellow : chalk.red;
  console.log(color(`\n  ${passed}/${total} tests passed\n`));
};

/**
 * Print throughput arena comparison table.
 *
 * @param {Array<{
 *   url: string,
 *   label: string,
 *   msgPerSec: number,
 *   bytesPerSec: number,
 *   latency: {min,max,avg,p50,p95,p99,stddev},
 *   lost: number,
 *   sent: number,
 *   error?: string
 * }>} results
 * @param {object} arenaOpts
 */
export const printArenaReport = (results, arenaOpts) => {
  const { messages, payloadBytes, publishers, subscribers, qos } = arenaOpts;

  headerLine('Throughput Arena');
  console.log(
    dim(
      `  messages=${messages}  payload=${formatBytes(payloadBytes)}  pub=${publishers}  sub=${subscribers}  qos=${qos}\n`
    )
  );

  // Find best msgPerSec to highlight winner
  const maxMps = Math.max(...results.filter((r) => !r.error).map((r) => r.msgPerSec));

  const headers = [
    chalk.white('Broker'),
    chalk.white('msg/s'),
    chalk.white('MB/s'),
    chalk.white('p50 lat'),
    chalk.white('p95 lat'),
    chalk.white('p99 lat'),
    chalk.white('lost'),
  ];
  const colWidths = [30, 12, 10, 12, 12, 12, 8];

  const rows = results.map((r) => {
    if (r.error) {
      return [chalk.red(r.label || r.url), chalk.red('ERROR'), '—', '—', '—', '—', '—'];
    }

    const isWinner = r.msgPerSec === maxMps;
    const label = isWinner ? chalk.green.bold(r.label || r.url) : r.label || r.url;
    const mps = isWinner ? chalk.green.bold(r.msgPerSec.toFixed(0)) : r.msgPerSec.toFixed(0);
    const lostPct = r.sent > 0 ? ((r.lost / r.sent) * 100).toFixed(1) : '0.0';
    const lostStr = r.lost > 0 ? chalk.red(`${r.lost} (${lostPct}%)`) : chalk.dim('0');

    return [
      label,
      mps,
      (r.bytesPerSec / 1024 / 1024).toFixed(2),
      formatMs(r.latency.p50),
      formatMs(r.latency.p95),
      formatMs(r.latency.p99),
      lostStr,
    ];
  });

  console.log(buildTable(headers, rows, colWidths));

  // Latency detail table
  headerLine('Latency Detail');
  const latHeaders = [
    chalk.white('Broker'),
    chalk.white('min'),
    chalk.white('avg'),
    chalk.white('p50'),
    chalk.white('p95'),
    chalk.white('p99'),
    chalk.white('max'),
    chalk.white('stddev'),
  ];
  const latColWidths = [30, 10, 10, 10, 10, 10, 10, 10];

  const latRows = results
    .filter((r) => !r.error)
    .map((r) => {
      const l = r.latency;
      return [
        r.label || r.url,
        formatMs(l.min),
        formatMs(l.avg),
        formatMs(l.p50),
        formatMs(l.p95),
        formatMs(l.p99),
        formatMs(l.max),
        formatMs(l.stddev),
      ];
    });

  console.log(buildTable(latHeaders, latRows, latColWidths));
  console.log();
};

/**
 * Simple inline progress printer (overwrites same line).
 * @param {string} label
 * @param {number} done
 * @param {number} total
 */
export const printProgress = (label, done, total) => {
  const pct = total > 0 ? ((done / total) * 100).toFixed(1) : '0.0';
  process.stdout.write(`\r  ${dim(label)}  ${chalk.cyan(done)}/${total}  (${pct}%)`);
  if (done >= total) {
    process.stdout.write('\n');
  }
};

/**
 * Print a single info line.
 * @param {string} msg
 */
export const info = (msg) => console.log(chalk.dim('  ' + msg));

/**
 * Print an error line.
 * @param {string} msg
 */
export const error = (msg) => console.error(chalk.red('  ✘ ' + msg));
