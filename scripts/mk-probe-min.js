/* =========================================================================
 * scripts/mk-probe-min.js — 把真机取证探针压成「单行版」（.min.js）
 *
 * 为什么必须单行：多行脚本经聊天/剪贴板复制会被折断（出现过一行拼接残片 ->
 * Uncaught SyntaxError，脚本根本没跑，白跑一轮真机复验）。
 *
 * 用法：
 *   node scripts/mk-probe-min.js scripts/probe-a.js scripts/probe-b.js
 *   每个 xxx.js 生成同目录 xxx.min.js
 *
 * 为什么不能只删整行注释：换行合并成空格后，**行尾注释**的 `//` 会把后面所有代码
 * 变成注释，脚本静默哑火，而 `node --check` 仍通过（整段被合法注释掉了）。
 * 故本脚本统一剥掉行首与行尾注释，并用三道闸自检：
 *   1. 分号计数与源文件一致（防语句被吞）；
 *   2. 产物不含 `//`、`/*`、反引号、换行；
 *   3. 调用方另跑 `node --check` 校验语法（见 tests/README.md 的真机取证段）。
 * ========================================================================= */
const fs = require('fs');
const path = require('path');

const sources = process.argv.slice(2);
if (!sources.length) {
  console.error('usage: node scripts/mk-probe-min.js <file.js> [file.js ...]');
  process.exit(1);
}

const lines = [];
let badCount = 0;

for (const src of sources) {
  const dir = path.dirname(src);
  const base = path.basename(src, '.js');
  const minPath = path.join(dir, base + '.min.js');

  const raw = fs.readFileSync(src, 'utf8');
  let s = raw;
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/[ \t]*\/\/.*$/gm, '');
  s = s.replace(/\s*[\r\n]+\s*/g, ' ');
  s = s.replace(/ {2,}/g, ' ');
  s = s.trim();
  fs.writeFileSync(minPath, s, 'utf8');

  const problems = [];
  if (s.indexOf('`') >= 0) { problems.push('backtick'); }
  if (s.indexOf('\n') >= 0) { problems.push('newline'); }
  if (s.indexOf('/*') >= 0) { problems.push('block-comment'); }
  if (s.indexOf('//') >= 0) { problems.push('line-comment'); }
  const srcSemi = (raw.match(/;/g) || []).length;
  const minSemi = (s.match(/;/g) || []).length;
  if (srcSemi !== minSemi) { problems.push('semicolon ' + srcSemi + ' -> ' + minSemi); }
  if (problems.length) { badCount++; }

  lines.push(
    base + '.min.js',
    '  bytes    = ' + Buffer.byteLength(s, 'utf8'),
    '  lines    = ' + s.split('\n').length,
    '  semicolon= ' + minSemi + ' (src ' + srcSemi + ')',
    '  problems = ' + (problems.length ? problems.join(', ') : 'none')
  );
}

console.log(lines.join('\n'));
process.exit(badCount ? 2 : 0);
