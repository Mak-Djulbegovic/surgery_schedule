#!/usr/bin/env node
/*
 * Builds a single-file version of the app (all CSS/JS inlined) so it can be
 * shared as one HTML file or published as a hosted page.
 *
 *   node tools/bundle.js            -> writes dist/surg-schedule.html
 *   node tools/bundle.js --bare     -> same, but without <!DOCTYPE>/<html>/
 *                                      <head>/<body> wrappers (for hosts that
 *                                      wrap the content themselves)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bare = process.argv.includes('--bare');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="css\/style.css">/, () =>
  '<style>\n' + fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8') + '\n</style>');

html = html.replace(/<script src="js\/([a-z]+)\.js"><\/script>/g, (m, name) =>
  '<script>\n' + fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8') + '\n</script>');

if (bare) {
  // Keep <title> + everything inside <head>/<body>; drop the outer shell tags.
  html = html
    .replace(/^<!DOCTYPE html>\s*/i, '')
    .replace(/<\/?html[^>]*>\s*/gi, '')
    .replace(/<\/?head>\s*/gi, '')
    .replace(/<\/?body>\s*/gi, '')
    .replace(/<meta charset[^>]*>\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'surg-schedule.html');
fs.writeFileSync(out, html);
console.log('wrote ' + out + ' (' + html.length + ' bytes' + (bare ? ', bare' : '') + ')');
