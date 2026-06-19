#!/usr/bin/env node
import { run } from '../src/cli.js';
run(process.argv.slice(2))
  .then((out) => { if (out) console.log(out); })
  .catch((e) => { console.error(e.message); process.exit(1); });
