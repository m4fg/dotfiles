---
name: campaign-page-coding
description: "Create and implement campaign landing pages (LPs) with mobile-first layout, rem-based sizing scaled from viewport width, and desktop framing that centers the mobile layout over a PC background. Use when asked to code a campaign page or when Figma designs must be matched closely."
---

# Campaign Page Coding

## Goals

- Prioritize the mobile layout as the base design.
- For desktop, place the mobile layout centered on top of the PC background design.
- Define every size in rem (fonts, images, spacing, borders, gaps).
- Set the html font-size from viewport width so the layout scales proportionally.
- If a Figma file exists, follow its layout and typography with highest priority.

## Workflow

1. Determine the mobile design width (e.g., 375px) from Figma or brief.
2. If a PC background design exists, identify its background asset and any safe margins.
3. Set root scaling to convert px to rem consistently.
4. Build the mobile layout as a centered container; place it on the PC background for desktop.
5. Convert every px value from the design to rem using the same scale.

## Scaling Pattern (Use Rem Everywhere)

Use this pattern so 1rem equals designWidth/10 at the mobile design width.

```css
:root {
  --design-width: 375px; /* mobile design width */
  --phone-max: 430px; /* max width for scaling on desktop */
  --scale-base: min(100vw, var(--phone-max));
}

html {
  font-size: calc(var(--scale-base) / var(--design-width) * 10);
}

body {
  margin: 0;
}

.campaign {
  width: calc(var(--design-width) / 10 * 1rem);
  margin: 0 auto;
}
```

- Convert px to rem with: `rem = px / (designWidth / 10)`.
- If the design width changes, update `--design-width` only.
- If you must allow full scaling on desktop, remove the `--phone-max` cap.

## Desktop Framing

- Use the PC background (image or color) on `body` or a wrapper.
- Center the `.campaign` container horizontally and vertically if specified.
- Keep the mobile layout visually consistent; do not reflow to a different layout.

## Figma Priority

- Match typography (font family, weight, size, line height, letter spacing).
- Match spacing and alignment exactly.
- Use assets from Figma where possible.
- If conflicts exist, Figma is the source of truth.

## Output Expectations

- Provide HTML/CSS (or the project framework) that follows these rules.
- Keep styles readable and consistent; no px usage in sizing.
- Reproduce text, colors, fonts, images, and other elements faithfully from Figma. Do not create or modify text without authorization.

