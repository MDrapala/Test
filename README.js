// go-dump-to-json.js
// Usage: node go-dump-to-json.js < input.txt

const fs = require('fs');

const src = fs.readFileSync(0, 'utf8');

// --- Tokenizer ---
function* tokenize(s) {
  let i = 0;
  const isWS = c => /\s/.test(c);
  const punct = new Set(['[', ']', '{', '}', ':']);
  while (i < s.length) {
    if (isWS(s[i])) { i++; continue; }
    if (s[i] === '"') {                      // quoted string
      let j = i + 1, out = '';
      while (j < s.length) {
        if (s[j] === '\\' && j + 1 < s.length) { out += s[j+1]; j += 2; continue; }
        if (s[j] === '"') break;
        out += s[j++];
      }
      yield { type: 'string', value: out };
      i = j + 1;
      continue;
    }
    if (s[i] === 'm' && s.slice(i, i+4) === 'map[') { // map[
      yield { type: 'map_open' };
      i += 4;
      continue;
    }
    if (punct.has(s[i])) {                    // punctuation
      const map = { '[':'[', ']':']', '{':'{', '}':'}', ':':':' };
      yield { type: 'punct', value: map[s[i]] };
      i++;
      continue;
    }
    // word (identifier/number/bare value)
    let j = i;
    while (j < s.length && !isWS(s[j]) && !punct.has(s[j]) ) j++;
    yield { type: 'word', value: s.slice(i, j) };
    i = j;
  }
}

// --- Parser (recursive descent) ---
function parseValue(it, stack=[]) {
  const t = it.peek();
  if (!t) return null;

  if (t.type === 'map_open') {                // map[...] -> object
    it.next();
    const obj = {};
    while (true) {
      const nxt = it.peek();
      if (!nxt) break;
      if (nxt.type === 'punct' && nxt.value === ']') { it.next(); break; }
      const keyTok = it.next();               // key
      if (!keyTok) break;
      const key = toKey(keyTok);
      expectColon(it);
      obj[key] = parseValue(it, stack);
    }
    return obj;
  }
  if (t.type === 'punct' && t.value === '{') { // struct {...} -> object
    it.next();
    const obj = {};
    while (true) {
      const nxt = it.peek();
      if (!nxt) break;
      if (nxt.type === 'punct' && nxt.value === '}') { it.next(); break; }
      const keyTok = it.next();
      const key = toKey(keyTok);
      expectColon(it);
      obj[key] = parseValue(it, stack);
    }
    return obj;
  }
  if (t.type === 'punct' && t.value === '[') { // array [...]
    it.next();
    const arr = [];
    while (true) {
      const nxt = it.peek();
      if (!nxt) break;
      if (nxt.type === 'punct' && nxt.value === ']') { it.next(); break; }
      arr.push(parseValue(it, stack));
    }
    return arr;
  }

  // primitives / bare words / quoted strings
  const tok = it.next();
  const raw = tok.type === 'string' ? tok.value : tok.value;

  if (tok.type === 'string') return raw;
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  if (/^nil$/i.test(raw)) return null;
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) return Number(raw);

  // default: bare word -> string
  return raw;
}

function toKey(tok) {
  if (!tok) return '';
  if (tok.type === 'string') return tok.value;
  return String(tok.value);
}

function expectColon(it) {
  const t = it.next();
  if (!t || t.type !== 'punct' || t.value !== ':') {
    throw new Error('Format non reconnu : ":" attendu après une clé');
  }
}

// Simple iterator with peek
function iter(tokens) {
  let i = 0;
  return {
    next: () => tokens[i++],
    peek: () => tokens[i],
  };
}

// Skip leading noise until first map[, { or [
function skipToStart(tokens) {
  let started = false;
  const out = [];
  for (const t of tokens) {
    if (!started && (t.type === 'map_open' || (t.type==='punct' && ['{','['].includes(t.value)))) {
      started = true;
      out.push(t);
    } else if (started) {
      out.push(t);
    }
  }
  return out;
}

const toks = Array.from(tokenize(src));
const cleaned = skipToStart(toks);
const it = iter(cleaned);

try {
  const result = parseValue(it);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (e) {
  console.error('Erreur de parsing:', e.message);
  process.exit(1);
}
