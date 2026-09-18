import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCss, minifyCss, validateCss, CssParseError } from '../src/lib/css.js';

// ---------------------------------------------------------------------------
// formatCss
// ---------------------------------------------------------------------------

test('formats a single simple rule with default 2-space indent', () => {
  const out = formatCss('.a{color:red;margin:0}');
  assert.equal(out, '.a {\n  color: red;\n  margin: 0;\n}');
});

test('formats multiple comma-separated selectors one per line', () => {
  const out = formatCss('h1,h2 ,h3{color:blue}');
  assert.equal(out, 'h1,\nh2,\nh3 {\n  color: blue;\n}');
});

test('blank line separates top-level rules, none after the last', () => {
  const out = formatCss('.a{color:red}.b{color:blue}');
  assert.equal(out, '.a {\n  color: red;\n}\n\n.b {\n  color: blue;\n}');
});

test('formatCss is idempotent', () => {
  const src = `
    @media (min-width: 600px) {
      .a, .b {
        color: red;
        /* note */
        font: 12px/1.5 sans-serif !important;
      }
    }
    .c { background: url(data:image/png;base64,AAA==) no-repeat; }
  `;
  const once = formatCss(src);
  const twice = formatCss(once);
  assert.equal(twice, once);
});

test('nested at-rules indent their body one level deeper', () => {
  const out = formatCss('@media (min-width:600px){.a{color:red}}');
  assert.equal(
    out,
    '@media (min-width:600px) {\n  .a {\n    color: red;\n  }\n}',
  );
});

test('@font-face body is declarations with no nested selector', () => {
  const out = formatCss("@font-face{font-family:'X';src:url(x.woff)}");
  assert.equal(out, "@font-face {\n  font-family: 'X';\n  src: url(x.woff);\n}");
});

test('custom indent option is honored', () => {
  const out = formatCss('.a{color:red}', { indent: '    ' });
  assert.equal(out, '.a {\n    color: red;\n}');
});

test('strings and url() contents are preserved verbatim', () => {
  const out = formatCss(`.a { content: "a; b: c, d"; background: url(foo(bar).png); }`);
  assert.equal(out, '.a {\n  content: "a; b: c, d";\n  background: url(foo(bar).png);\n}');
});

test('standalone comments get their own line at the current indent', () => {
  const out = formatCss('/* top */\n.a{\n/* inner */\ncolor:red;\n}');
  assert.equal(out, '/* top */\n.a {\n  /* inner */\n  color: red;\n}');
});

test('!important is preserved', () => {
  const out = formatCss('.a{color:red!important}');
  assert.equal(out, '.a {\n  color: red!important;\n}');
});

test('a declaration missing its trailing semicolon still gets one', () => {
  const out = formatCss('.a{color:red}');
  assert.match(out, /color: red;\n/);
});

// ---------------------------------------------------------------------------
// minifyCss
// ---------------------------------------------------------------------------

test('minify removes whitespace, comments, and the last semicolon before }', () => {
  const out = minifyCss('.a {\n  color: red;\n  margin: 0; /* c */\n}');
  assert.equal(out, '.a{color:red;margin:0}');
});

test('minify collapses comma-separated selectors and declarations tightly', () => {
  const out = minifyCss('h1, h2 ,h3 { color: blue; padding: 1px , 2px; }');
  assert.equal(out, 'h1,h2,h3{color:blue;padding:1px,2px}');
});

test('minify keeps license comments (/*! ... */) but drops others', () => {
  const out = minifyCss('/*! keep me */\n/* drop me */\n.a{color:red}');
  assert.equal(out, '/*! keep me */.a{color:red}');
});

test('minify keeps calc() operators spaced but drops selector combinator spaces', () => {
  const out = minifyCss('.a > .b { width: calc(1px + 2px); }');
  assert.equal(out, '.a>.b{width:calc(1px + 2px)}');
});

test('minify preserves strings and url() contents exactly', () => {
  const out = minifyCss(`.a { content: "a b, c: d"; background: url(data:image/png;base64,AAA==); }`);
  assert.equal(out, '.a{content:"a b, c: d";background:url(data:image/png;base64,AAA==)}');
});

test('minify preserves the meaningful descendant-combinator space', () => {
  const out = minifyCss('a :hover { color: red; }');
  assert.equal(out, 'a :hover{color:red}');
});

test('minify handles nested at-rules', () => {
  const out = minifyCss('@media (min-width: 600px) {\n  .a { color: red; }\n}');
  assert.equal(out, '@media (min-width: 600px){.a{color:red}}');
});

// ---------------------------------------------------------------------------
// validateCss
// ---------------------------------------------------------------------------

test('validateCss accepts well-formed CSS', () => {
  assert.doesNotThrow(() => validateCss('.a { color: red; } @media (min-width: 1px) { .b { color: blue; } }'));
});

function expectCssParseError(fn: () => void): CssParseError {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof CssParseError, `expected a CssParseError, got ${String(e)}`);
    return e as CssParseError;
  }
  throw new assert.AssertionError({ message: 'expected function to throw a CssParseError' });
}

test('validateCss reports an unclosed block with line/col of the opening brace', () => {
  const err = expectCssParseError(() => validateCss('.a {\n  color: red;\n'));
  assert.equal(err.line, 1);
  assert.equal(err.col, 4);
  assert.match(err.hint ?? '', /matching `}`/);
});

test('validateCss reports an unmatched closing brace with its own line/col', () => {
  const err = expectCssParseError(() => validateCss('.a { color: red; }\n}\n'));
  assert.equal(err.line, 2);
  assert.equal(err.col, 1);
  assert.match(err.hint ?? '', /Remove this/);
});

test('validateCss reports an unterminated string with the position where it opened', () => {
  const err = expectCssParseError(() => validateCss('.a { content: "unterminated; }\n'));
  assert.equal(err.line, 1);
  assert.equal(err.col, 15);
  assert.match(err.hint ?? '', /closing/);
});

test('validateCss reports an unterminated comment with the position where it opened', () => {
  const err = expectCssParseError(() => validateCss('.a { color: red; }\n/* oops\n.b { color: blue; }\n'));
  assert.equal(err.line, 2);
  assert.equal(err.col, 1);
  assert.match(err.hint ?? '', /\*\//);
});

test('formatCss and minifyCss surface validateCss errors as CssParseError', () => {
  assert.throws(() => formatCss('.a { color: red; '), CssParseError);
  assert.throws(() => minifyCss('.a { color: red; '), CssParseError);
});
