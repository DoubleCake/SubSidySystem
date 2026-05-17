#!/usr/bin/env python3
"""批量替换 Tailwind CSS 类名为新设计系统令牌"""
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIRS = [
    os.path.join(BASE_DIR, 'src', 'pages'),
    os.path.join(BASE_DIR, 'src', 'components'),
]

# 替换规则： (模式字符串, 替换字符串)
# 更具体的规则在前
REPLACEMENTS = [
    # Opacity variants (before base replacements)
    (r'bg-stone-50/50', 'bg-warm/10'),
    (r'bg-stone-100/50', 'bg-warm/15'),

    # Emerald replacements
    (r'bg-emerald-700', 'bg-primary'),
    (r'bg-emerald-600', 'bg-primary/90'),
    (r'bg-emerald-50', 'bg-primary/5'),
    (r'text-emerald-700', 'text-primary'),
    (r'text-emerald-600', 'text-primary'),
    (r'text-emerald-500', 'text-primary/70'),
    (r'text-emerald-400', 'text-primary/60'),
    (r'hover:bg-emerald-50', 'hover:bg-primary/5'),
    (r'hover:text-emerald-600', 'hover:text-primary'),
    (r'border-emerald-200', 'border-primary/20'),
    (r'border-emerald-300', 'border-primary/30'),

    # Stone replacements
    (r'bg-stone-100', 'bg-warm/30'),
    (r'bg-stone-50', 'bg-warm/30'),
    (r'text-stone-700', 'text-text-primary'),
    (r'text-stone-600', 'text-text-primary'),
    (r'text-stone-500', 'text-text-muted'),
    (r'text-stone-400', 'text-text-muted'),
    (r'text-stone-300', 'text-text-muted/50'),
    (r'border-stone-200', 'border-border'),
    (r'border-stone-100', 'border-border/50'),

    # Additional patterns
    (r'text-stone-800', 'text-text-primary'),
    (r'hover:bg-stone-100', 'hover:bg-warm/30'),
    (r'hover:bg-stone-50', 'hover:bg-warm/30'),
    (r'hover:text-stone-700', 'hover:text-text-primary'),
    (r'hover:text-stone-600', 'hover:text-text-primary'),
    (r'hover:border-stone-200', 'hover:border-border'),
    (r'border-emerald-500', 'border-primary'),
    (r'focus:border-emerald-400', 'focus:border-primary'),
    (r'accent-emerald-600', 'accent-primary'),
    (r'border-emerald-100', 'border-primary/10'),

    # Additional emerald hover
    (r'hover:border-emerald-200', 'hover:border-primary/20'),
    (r'hover:border-emerald-300', 'hover:border-primary/30'),
    (r'hover:border-emerald-400', 'hover:border-primary'),
    (r'hover:bg-emerald-600', 'hover:bg-primary/90'),
    (r'hover:bg-emerald-700', 'hover:bg-primary'),
    (r'hover:bg-emerald-500', 'hover:bg-primary/70'),

    # Additional stone hover
    (r'hover:border-stone-300', 'hover:border-border'),
    (r'hover:border-stone-400', 'hover:border-border'),
    (r'hover:bg-stone-200', 'hover:bg-warm/40'),

    # Layout replacements
    (r'shadow-sm', 'shadow-card'),
    (r'shadow-md', 'shadow-card'),
    (r'rounded-xl', 'rounded-card'),
    (r'rounded-lg', 'rounded-btn'),
    (r'rounded-2xl', 'rounded-card'),
]

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    changed = False
    for pattern, replacement in REPLACEMENTS:
        new_content = re.sub(pattern, replacement, content)
        if new_content != content:
            changed = True
            content = new_content

    if changed:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Updated: {filepath}')
    else:
        print(f'No changes: {filepath}')


for d in DIRS:
    if os.path.exists(d):
        for fname in os.listdir(d):
            if fname.endswith('.tsx'):
                process_file(os.path.join(d, fname))

print('Done!')
