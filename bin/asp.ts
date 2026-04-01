#!/usr/bin/env node
import { runCli } from '../src/cli-runner.js';

process.exitCode = await runCli(process.argv);
