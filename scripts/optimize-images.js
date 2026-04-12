#!/usr/bin/env node
// Converts all PNG/JPG screenshots in public/connect/images/ (and subdirectories) to WebP in-place.
// Original files are deleted after successful conversion.
// Run with: node scripts/optimize-images.js

import sharp from 'sharp';
import { readdir, unlink, stat } from 'fs/promises';
import { extname, basename, join, dirname } from 'path';

const DIR = 'public/connect/images';
const MAX_WIDTH = 1400;
const QUALITY = 85;

// readdir with recursive:true returns relative paths like "chat_examples/foo.png"
const files = await readdir(DIR, { recursive: true });
const images = files.filter(f => /\.(png|jpe?g)$/i.test(f));

if (images.length === 0) {
  console.log('No PNG/JPG files found.');
  process.exit(0);
}

for (const file of images) {
  const input = join(DIR, file);
  const output = join(DIR, dirname(file), basename(file, extname(file)) + '.webp');

  const { size: before } = await stat(input);

  await sharp(input)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(output);

  const { size: after } = await stat(output);
  const saving = Math.round((1 - after / before) * 100);

  console.log(`${file} → ${output.replace(DIR + '/', '')}  ${kb(before)} → ${kb(after)} (${saving}% smaller)`);

  await unlink(input);
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}
