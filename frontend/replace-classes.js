const fs = require('fs');
const path = require('path');

const dirs = [
  path.join(__dirname, 'src', 'pages'),
  path.join(__dirname, 'src', 'components'),
  path.join(__dirname, 'src', 'utils'),
];

// Replacement map: [pattern, replacement]
// Order matters - more specific patterns first
const replacements = [
  // Opacity variants (before base replacements)
  [/bg-stone-50\/50/g, 'bg-warm/10'],
  [/bg-stone-100\/50/g, 'bg-warm/15'],

  // Emerald replacements (from user mapping)
  [/bg-emerald-700/g, 'bg-primary'],
  [/bg-emerald-600/g, 'bg-primary/90'],
  [/bg-emerald-50/g, 'bg-primary/5'],
  [/text-emerald-700/g, 'text-primary'],
  [/text-emerald-600/g, 'text-primary'],
  [/text-emerald-500/g, 'text-primary/70'],
  [/text-emerald-400/g, 'text-primary/60'],
  [/hover:bg-emerald-50/g, 'hover:bg-primary/5'],
  [/hover:text-emerald-600/g, 'hover:text-primary'],
  [/border-emerald-200/g, 'border-primary/20'],
  [/border-emerald-300/g, 'border-primary/30'],

  // Stone replacements (from user mapping)
  [/bg-stone-100/g, 'bg-warm/30'],
  [/bg-stone-50/g, 'bg-warm/30'],
  [/text-stone-700/g, 'text-text-primary'],
  [/text-stone-600/g, 'text-text-primary'],
  [/text-stone-500/g, 'text-text-muted'],
  [/text-stone-400/g, 'text-text-muted'],
  [/text-stone-300/g, 'text-text-muted/50'],
  [/border-stone-200/g, 'border-border'],
  [/border-stone-100/g, 'border-border/50'],

  // Additional patterns per user instructions
  [/text-stone-800/g, 'text-text-primary'],
  [/hover:bg-stone-100/g, 'hover:bg-warm/30'],
  [/hover:bg-stone-50/g, 'hover:bg-warm/30'],
  [/hover:text-stone-700/g, 'hover:text-text-primary'],
  [/hover:text-stone-600/g, 'hover:text-text-primary'],
  [/hover:border-stone-200/g, 'hover:border-border'],
  [/border-emerald-500/g, 'border-primary'],
  [/focus:border-emerald-400/g, 'focus:border-primary'],
  [/accent-emerald-600/g, 'accent-primary'],
  [/border-emerald-100/g, 'border-primary/10'],
  [/text-emerald-800/g, 'text-primary'],
  [/hover:bg-emerald-600/g, 'hover:bg-primary/90'],
  [/hover:bg-emerald-700/g, 'hover:bg-primary'],
  [/hover:border-emerald-200/g, 'hover:border-primary/20'],

  // Missing stone patterns
  [/border-stone-50/g, 'border-border/50'],
  [/hover:border-stone-300/g, 'hover:border-border'],

  // Layout replacements
  [/rounded-2xl/g, 'rounded-card'],
  [/shadow-sm/g, 'shadow-card'],
  [/shadow-md/g, 'shadow-card'],
  [/rounded-xl/g, 'rounded-card'],
  [/rounded-lg/g, 'rounded-btn'],
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;
  for (const [pattern, replacement] of replacements) {
    const newContent = content.replace(pattern, replacement);
    if (newContent !== content) {
      changed = true;
      content = newContent;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated: ${filePath}`);
  } else {
    console.log(`No changes: ${filePath}`);
  }
}

// Get all .tsx files from the directories
for (const dir of dirs) {
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));
    for (const file of files) {
      processFile(path.join(dir, file));
    }
  }
}

console.log('Done!');
