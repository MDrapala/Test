// tools/convert/golangToJSON.js
// Convertit un dump "façon Go" (map[...], {...}, nil, etc.) en JSON.
// Usage :
//   node tools/convert/golangToJSON.js <inputPath> [outputPath]
//
// Exemples :
//   node tools/convert/golangToJSON.js tools/convert/input.txt
//   node tools/convert/golangToJSON.js tools/convert/input.txt out.json

const fs = require('fs');

const inPath = process.argv[2] || './input.txt';
const outPath = process.argv[3] || null;

const src = fs.readFileSync(inPath, 'utf8');

// ---------- Tokenizer ----------
function* tokenize(s) {
  let i = 0;
  const isWS = (c) => /\s/.test(c);
  const punct = new Set(['[', ']', '{', '}', ':']);

  while (i < s.length) {
    if (isWS(s[i])) { i++; continue; }

    // quoted string "..."
    if (s[i] === '"') {
      let j = i + 1, out = '';
      while (j < s.length) {
        if (s[j] === '\\' && j + 1 < s.length) { out += s[j + 1]; j += 2; continue; }
        if (s[j] === '"') break;
        out += s[j++];
      }
      yield { type: 'string', value: out };
      i = Math.min(j + 1, s.length);
      continue;
    }

    // map[
    if (s[i] === 'm' && s.slice(i, i + 4) === 'map[') {
      yield { type: 'map_open' };
      i += 4;
      continue;
    }

    // punctuation
    if (punct.has(s[i])) {
      yield { type: 'punct', value: s[i] };
      i++;
      continue;
    }

    // bare word (no spaces, no punct)
    let j = i;
    while (j < s.length && !isWS(s[j]) && !punct.has(s[j])) j++;
    yield { type: 'word', value: s.slice(i, j) };
    i = j;
  }
}

// ---------- Utils ----------
function iter(tokens) {
  let i = 0;
  return {
    next: () => tokens[i++],
    peek: (k = 0) => tokens[i + k],
  };
}

function toKey(tok) {
  if (!tok) return '';
  return tok.type === 'string' ? tok.value : String(tok.value);
}

function expectColon(it) {
  const t = it.next();
  if (!t || t.type !== 'punct' || t.value !== ':') {
    throw new Error('Format non reconnu : ":" attendu après une clé');
  }
}

function isNextKey(it) {
  const t1 = it.peek(0);
  const t2 = it.peek(1);
  return t1 && t1.type === 'word' && t2 && t2.type === 'punct' && t2.value === ':';
}

// Accumule une valeur scalaire (mots non quotés avec espaces) jusqu’à la prochaine clé, ] ou }
function parseScalar(it) {
  let tok = it.next();
  if (!tok) return null;

  if (tok.type === 'string') return tok.value;

  let parts = [tok.value];
  while (true) {
    const t = it.peek(0);
    if (!t) break;
    if (t.type === 'punct' && (t.value === ']' || t.value === '}')) break; // fin conteneur
    if (isNextKey(it)) break;                                              // début prochaine clé
    if (t.type === 'punct' && t.value === ':') break;                      // sécurité
    it.next();
    parts.push(t.type === 'string' ? t.value : t.value);
  }

  const raw = parts.join(' ');

  // Typage simple si un seul "mot"
  if (parts.length === 1) {
    if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
    if (/^nil$/i.test(raw)) return null;
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) return Number(raw);
  }
  return raw;
}

// ---------- Parser ----------
function parseValue(it) {
  const t = it.peek();
  if (!t) return null;

  // map[...] -> object
  if (t.type === 'map_open') {
    it.next();
    const obj = {};
    while (true) {
      const nxt = it.peek();
      if (!nxt) break;
      if (nxt.type === 'punct' && nxt.value === ']') { it.next(); break; }

      const keyTok = it.next();
      const key = toKey(keyTok);

      expectColon(it);

      const vStart = it.peek();
      if (!vStart) { obj[key] = null; break; }
      if (vStart.type === 'map_open' || (vStart.type === 'punct' && (vStart.value === '[' || vStart.value === '{'))) {
        obj[key] = parseValue(it);
      } else {
        obj[key] = parseScalar(it);
      }
    }
    return obj;
  }

  // struct {...} -> object
  if (t.type === 'punct' && t.value === '{') {
    it.next();
    const obj = {};
    while (true) {
      const nxt = it.peek();
      if (!nxt) break;
      if (nxt.type === 'punct' && nxt.value === '}') { it.next(); break; }

      const keyTok = it.next();
      const key = toKey(keyTok);

      expectColon(it);

      const vStart = it.peek();
      if (!vStart) { obj[key] = null; break; }
      if (vStart.type === 'map_open' || (vStart.type === 'punct' && (vStart.value === '[' || vStart.value === '{'))) {
        obj[key] = parseValue(it);
      } else {
        obj[key] = parseScalar(it);
      }
    }
    return obj;
  }

  // array [...]
  if (t.type === 'punct' && t.value === '[') {
    it.next();
    const arr = [];
    while (true) {
      const nxt = it.peek();
      if (!nxt) break;
      if (nxt.type === 'punct' && nxt.value === ']') { it.next(); break; }

      if (nxt.type === 'map_open' || (nxt.type === 'punct' && (nxt.value === '[' || nxt.value === '{'))) {
        arr.push(parseValue(it));
      } else {
        arr.push(parseScalar(it));
      }
    }
    return arr;
  }

  // sinon un scalaire
  return parseScalar(it);
}

// Ignore le bruit avant le premier map[, { ou [
function skipToStart(tokens) {
  let started = false;
  const out = [];
  for (const t of tokens) {
    if (!started && (t.type === 'map_open' || (t.type === 'punct' && (t.value === '{' || t.value === '[')))) {
      started = true;
      out.push(t);
    } else if (started) {
      out.push(t);
    }
  }
  return out;
}

// ---------- Run ----------
const tokens = Array.from(tokenize(src));
const cleaned = skipToStart(tokens);
const it = iter(cleaned);

let result = null;
try {
  result = parseValue(it);
} catch (e) {
  console.error('Erreur de parsing:', e.message);
  process.exit(1);
}

const json = JSON.stringify(result, null, 2);
if (outPath) {
  fs.writeFileSync(outPath, json);
  console.log(`OK -> ${outPath}`);
} else {
  process.stdout.write(json + '\n');
}
