import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, formatXml, minifyXml, xmlToJson, jsonToXml, XmlParseError } from '../src/lib/xml.js';

/** Asserts that parsing `src` fails at `line`/`col`, with a message and hint matching the patterns. */
function assertError(src: string, line: number, col: number, message: RegExp, hint?: RegExp): XmlParseError {
  try {
    parseXml(src);
  } catch (e) {
    assert.ok(e instanceof XmlParseError, `expected XmlParseError, got ${String(e)}`);
    assert.match(e.message, message);
    assert.deepEqual([e.line, e.col], [line, col], `position for: ${e.message}`);
    if (hint) assert.match(e.hint ?? '', hint);
    return e;
  }
  assert.fail(`expected parse error for ${JSON.stringify(src)}`);
}

/* ---------------- parsing: happy paths ---------------- */

test('parses declaration, doctype, comments, PIs, CDATA and attributes', () => {
  const doc = parseXml(
    '<?xml version="1.0" encoding="UTF-8" standalone=\'yes\'?>\n' +
      '<!DOCTYPE note [<!ELEMENT note (#PCDATA)>]>\n' +
      '<!-- top -->\n' +
      '<?xml-stylesheet href="s.css"?>\n' +
      '<note id="1" x:lang=\'en\'><![CDATA[<raw> & stuff]]><?php echo 1; ?></note>\n' +
      '<!-- tail -->\n',
  );
  assert.deepEqual(doc.declaration, { version: '1.0', encoding: 'UTF-8', standalone: 'yes' });
  assert.deepEqual(doc.children, [
    { type: 'doctype', value: 'note [<!ELEMENT note (#PCDATA)>]' },
    { type: 'comment', value: ' top ' },
    { type: 'pi', target: 'xml-stylesheet', value: 'href="s.css"' },
    {
      type: 'element',
      name: 'note',
      attrs: [
        { name: 'id', value: '1' },
        { name: 'x:lang', value: 'en' },
      ],
      children: [
        { type: 'cdata', value: '<raw> & stuff' },
        { type: 'pi', target: 'php', value: 'echo 1; ' },
      ],
    },
    { type: 'comment', value: ' tail ' },
  ]);
});

test('decodes predefined entities and numeric refs in text and attributes', () => {
  const doc = parseXml('<a t="&quot;x&quot; &#65;&#x42;&apos;">&lt;b&gt; &amp; &#x1F600;&#169;</a>');
  const a = doc.children[0];
  assert.ok(a && a.type === 'element');
  assert.equal(a.attrs[0]?.value, '"x" AB\'');
  assert.deepEqual(a.children, [{ type: 'text', value: '<b> & 😀©' }]);
});

test('normalizes CRLF, strips BOM, normalizes attribute whitespace, allows self-closing and nesting', () => {
  const doc = parseXml('﻿<r>\r\n  <a v="x\ty\nz"/>\r\n  <b><c/></b>\r\n</r>');
  const r = doc.children[0];
  assert.ok(r && r.type === 'element');
  const elements = r.children.filter((c) => c.type === 'element');
  assert.equal(elements.length, 2);
  assert.deepEqual(elements[0], { type: 'element', name: 'a', attrs: [{ name: 'v', value: 'x y z' }], children: [] });
  assert.equal(r.children[0]?.type === 'text' && r.children[0].value, '\n  ');
});

test('handles very deep nesting without recursion', () => {
  const depth = 20000;
  const src = '<a>'.repeat(depth) + 'x' + '</a>'.repeat(depth);
  const doc = parseXml(src);
  assert.equal(doc.children.length, 1);
});

/* ---------------- parsing: errors ---------------- */

test('error: unclosed tag points at the innermost open tag', () => {
  assertError('<root>\n  <item>\n    text\n', 2, 3, /Unclosed tag <item>/, /<\/item>/);
});

test('error: start tag never finished', () => {
  assertError('<root attr="1"', 1, 1, /never closed/, /`>`/);
  assertError('<root\n<child/>', 2, 1, /missing its closing `>`/);
});

test('error: mismatched closing tag names the expected tag', () => {
  const e = assertError('<a>\n  <b>text</c>\n</a>', 2, 10, /Mismatched closing tag <\/c>/, /Expected <\/b>/);
  assert.match(e.hint ?? '', /line 2, col 3/);
  const e2 = assertError('<a><b></a>', 1, 7, /Mismatched closing tag <\/a>/, /Expected <\/b>.*missing its closing tag/);
  assert.ok(e2);
});

test('error: unquoted, valueless and duplicate attributes', () => {
  assertError('<a x=1/>', 1, 6, /not quoted/, /x="1"/);
  assertError('<a checked>', 1, 11, /`checked` has no value/, /checked="…"/);
  assertError('<a x="1"\n   x="2"/>', 2, 4, /Duplicate attribute `x`/, /line 1, col 4/);
  assertError('<a x="1"y="2"/>', 1, 9, /Missing whitespace/);
  assertError('<a x="1 />\n<b/>', 2, 1, /`<` is not allowed in attribute values/, /closing " quote missing/);
});

test('error: `<` and `&` in text, unknown entities', () => {
  assertError('<a>1 < 2</a>', 1, 6, /Unescaped `<`/, /&lt;/);
  assertError('<a>\nfish & chips</a>', 2, 6, /Unescaped `&`/, /&amp;/);
  assertError('<a>x&nbsp;y</a>', 1, 5, /Unknown entity `&nbsp;`/, /&#160;/);
  assertError('<a v="&foo;"/>', 1, 7, /Unknown entity `&foo;`/, /predefines/);
  assertError('<a>&#0;</a>', 1, 4, /Invalid character reference/);
  assertError('<a>&#xZZ;</a>', 1, 4, /Malformed character reference/);
  assertError('<a>x]]>y</a>', 1, 5, /`]]>` is not allowed/);
});

test('error: unterminated comment, CDATA, PI, DOCTYPE', () => {
  assertError('<a>\n  <!-- oops\n</a>', 2, 3, /Comment is never closed/, /-->/);
  assertError('<a><![CDATA[ x </a>', 1, 4, /CDATA section is never closed/, /]]>/);
  assertError('<a>\n<?php echo 1;</a>', 2, 1, /Processing instruction is never closed/, /\?>/);
  assertError('<!DOCTYPE x [ <!ENTITY y "z"> \n<x/>', 1, 1, /DOCTYPE is never closed/);
  assertError('<a><!-- a -- b --></a>', 1, 11, /`--` is not allowed/);
});

test('error: multiple roots, junk after root, stray close tag, misplaced declaration', () => {
  assertError('<a/>\n<b/>', 2, 1, /Multiple root elements: <b> follows <\/a>/, /single parent/);
  assertError('<a></a>\ntrailing', 2, 1, /Unexpected content after the root/);
  assertError('<a></a></a>', 1, 8, /Unexpected closing tag <\/a>/, /already closed/);
  assertError(' <?xml version="1.0"?><a/>', 1, 2, /XML declaration is only allowed at the very start/, /whitespace/);
  assertError('hello <a/>', 1, 1, /Text outside the root element/);
  assertError('   \n  ', 2, 3, /Document is empty/);
  assertError('<!-- only -->', 1, 14, /No root element/);
  assertError('<?xml version="1.0" foo="x"?><a/>', 1, 21, /Unknown XML declaration attribute `foo`/);
});

test('XmlParseError is a proper Error subclass', () => {
  const e = assertError('<a>', 1, 1, /Unclosed/);
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'XmlParseError');
});

/* ---------------- formatting ---------------- */

test('formatXml: indentation, inline text, self-closing, escaping, declaration first', () => {
  const src =
    '<?xml version="1.0"?><!DOCTYPE r><r a="x &amp; &quot;y&quot;"><!--c--><item>one &lt; two</item>' +
    '<item>   </item><group><x/><y k="v">t</y></group><?pi data?></r>';
  assert.equal(
    formatXml(parseXml(src)),
    [
      '<?xml version="1.0"?>',
      '<!DOCTYPE r>',
      '<r a="x &amp; &quot;y&quot;">',
      '  <!--c-->',
      '  <item>one &lt; two</item>',
      '  <item/>',
      '  <group>',
      '    <x/>',
      '    <y k="v">t</y>',
      '  </group>',
      '  <?pi data?>',
      '</r>',
    ].join('\n'),
  );
});

test('formatXml: custom indent, reindents messy input, keeps mixed content inline and exact', () => {
  const src = '<doc>\n\n        <p>Hello <b>big</b> <i>world</i>!</p>\n   <c><![CDATA[a]]></c>\n</doc>';
  assert.equal(
    formatXml(parseXml(src), { indent: '\t' }),
    '<doc>\n\t<p>Hello <b>big</b> <i>world</i>!</p>\n\t<c><![CDATA[a]]></c>\n</doc>',
  );
});

test('format -> parse round trip preserves the tree (ignoring layout whitespace) and is idempotent', () => {
  const src =
    '<?xml version="1.0" encoding="utf-8"?><cat xmlns:x="urn:x"><x:book id="b&lt;1" note="tab\there">' +
    '<title>A &amp; B</title><p>mixed <em>content</em> here</p><empty/><![CDATA[]]]]><![CDATA[>]]></x:book></cat>';
  const once = formatXml(parseXml(src));
  const twice = formatXml(parseXml(once));
  assert.equal(twice, once);
  assert.equal(minifyXml(parseXml(once)), minifyXml(parseXml(src)));
  const book = parseXml(once).children[0];
  assert.ok(book?.type === 'element');
  const inner = book.children.find((c) => c.type === 'element');
  assert.ok(inner?.type === 'element');
  assert.deepEqual(inner.attrs, [
    { name: 'id', value: 'b<1' },
    { name: 'note', value: 'tab here' },
  ]);
});

test('attribute values with literal newlines survive a round trip via char refs', () => {
  const doc = {
    children: [{ type: 'element' as const, name: 'a', attrs: [{ name: 'v', value: 'l1\nl2\t<&>"' }], children: [] }],
  };
  const out = formatXml(doc);
  assert.equal(out, '<a v="l1&#10;l2&#9;&lt;&amp;>&quot;"/>');
  assert.deepEqual(parseXml(out), doc);
});

/* ---------------- minify ---------------- */

test('minifyXml removes layout whitespace but preserves text content', () => {
  const src =
    '<?xml version="1.0"?>\n<!-- c -->\n<r>\n  <a>\n    hello world\n  </a>\n  <b> spaced </b>\n' +
    '  <p>Hi <i>there</i> you</p>\n  <e>\n  </e>\n</r>\n';
  assert.equal(
    minifyXml(parseXml(src)),
    '<?xml version="1.0"?><!-- c --><r><a>hello world</a><b> spaced </b><p>Hi <i>there</i> you</p><e/></r>',
  );
});

/* ---------------- JSON conversion ---------------- */

test('xmlToJson follows the documented convention', () => {
  const doc = parseXml(
    '<?xml version="1.0"?><!-- dropped --><library name="City">' +
      '<book id="1"><title>Dune</title><tag>sf</tag><tag>classic</tag></book>' +
      '<book id="2">Untitled</book>' +
      '<note>Hello <b>bold</b> world</note>' +
      '<empty/><cd><![CDATA[<x>]]></cd><?pi dropped?>' +
      '</library>',
  );
  assert.deepEqual(xmlToJson(doc), {
    library: {
      '@name': 'City',
      book: [
        { '@id': '1', title: 'Dune', tag: ['sf', 'classic'] },
        { '@id': '2', '#text': 'Untitled' },
      ],
      note: { b: 'bold', '#text': 'Hello world' },
      empty: '',
      cd: '<x>',
    },
  });
});

test('xmlToJson ignores layout whitespace in pretty-printed input', () => {
  const doc = parseXml('<r>\n  <a>1</a>\n  <a>2</a>\n  <b x="y">\n  </b>\n</r>');
  assert.deepEqual(xmlToJson(doc), { r: { a: ['1', '2'], b: { '@x': 'y' } } });
});

test('jsonToXml: single-key root, arrays, attributes, #text, escaping, null', () => {
  const xml = jsonToXml({
    library: {
      '@name': 'A & B',
      book: [{ '@id': 1, title: 'Dune' }, { title: '<Emma>' }],
      count: 2,
      ok: true,
      missing: null,
      labelled: { '@lang': 'en', '#text': 'hi' },
    },
  });
  assert.equal(
    xml,
    [
      '<library name="A &amp; B">',
      '  <book id="1">',
      '    <title>Dune</title>',
      '  </book>',
      '  <book>',
      '    <title>&lt;Emma&gt;</title>',
      '  </book>',
      '  <count>2</count>',
      '  <ok>true</ok>',
      '  <missing/>',
      '  <labelled lang="en">hi</labelled>',
      '</library>',
    ].join('\n'),
  );
});

test('jsonToXml: wraps multi-key objects, primitives and arrays; sanitizes names; custom indent', () => {
  assert.equal(jsonToXml({ a: 1, b: 2 }), '<root>\n  <a>1</a>\n  <b>2</b>\n</root>');
  assert.equal(jsonToXml({ a: 1, b: 2 }, { rootName: 'data', indent: '    ' }), '<data>\n    <a>1</a>\n    <b>2</b>\n</data>');
  assert.equal(jsonToXml('hello'), '<root>hello</root>');
  assert.equal(jsonToXml(null), '<root/>');
  assert.equal(jsonToXml([1, [2, 3]]), '<root>\n  <item>1</item>\n  <item>\n    <item>2</item>\n    <item>3</item>\n  </item>\n</root>');
  assert.equal(jsonToXml({ list: [1, 2] }), '<root>\n  <list>1</list>\n  <list>2</list>\n</root>');
  assert.equal(jsonToXml({ 'first name': 'Ann', '1st': 'x', '': 'y' }), '<root>\n  <first_name>Ann</first_name>\n  <_1st>x</_1st>\n  <_>y</_>\n</root>');
});

test('JSON -> XML -> JSON round trip for string data', () => {
  const data = {
    catalog: {
      '@version': '2',
      item: [
        { '@sku': 'a1', name: 'Widget', tags: { tag: ['x', 'y'] } },
        { '@sku': 'b2', name: 'Gadget & Co', note: { '#text': 'fragile', '@level': 'high' } },
      ],
      mixed: { '#text': 'intro', part: 'p1' },
      plain: 'text with <angle> brackets',
    },
  };
  const xml = jsonToXml(data);
  assert.deepEqual(xmlToJson(parseXml(xml)), data);
});

test('XML -> JSON -> XML round trip for data-shaped XML', () => {
  const src = '<orders>\n  <order id="7">\n    <line>a</line>\n    <line>b</line>\n    <total>3.50</total>\n  </order>\n</orders>';
  assert.equal(jsonToXml(xmlToJson(parseXml(src))), src);
});
