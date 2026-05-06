# Recent Updates

The connect page has a "Recent updates" section near the top. Keep the 10 latest meaningful changes, newest first. The page shows the first 5 by default and reveals the rest with a Show more button. Keep entries to things an end user or evaluator would care about. Drop the oldest entry when adding a new one after there are already 10.

---

## Badge types

Use one badge per entry. Choose based on what actually changed:

| Badge | Color | When to use |
|---|---|---|
| `New` | Green | A capability that did not exist before (new tool, new client support) |
| `Improved` | Blue | An existing capability that works better or covers more cases |
| `Fixed` | Amber | Something that was broken and now works |
| `Note` | Gray | Information or documentation only, no new capability |

In `index.html`, badges are `<span>` elements with a class:

```html
<span class="badge-new">New</span>
<span class="badge-improved">Improved</span>
<span class="badge-fixed">Fixed</span>
<span class="badge-note">Note</span>
```

---

## Format

Each entry is one bullet point:

```
- <span class="badge-new">New</span> **Month Year:** Short description of what changed and why it matters to the user.
```

Keep the description to one sentence. Link to the relevant section on the page if useful.

---

## What belongs here

Include:
- New tools
- New client support
- Behavior changes that affect what users can do or expect
- Important clarifications (mobile support, known limitations)

Exclude:
- Visual or layout fixes
- Internal refactors
- Documentation rewrites with no user-facing change
- Bug fixes so minor the user would never have noticed the bug

---

## Current entries (as of May 2026)

```
- <span class="badge-new">New</span> **May 2026:** Full product detail reads added. Inspect product attributes, categories, assets, and relations before writing updates.
- <span class="badge-new">New</span> **May 2026:** Select enum value append added. Add missing single-select and multi-select values with a guarded read-merge-write flow.
- <span class="badge-new">New</span> **May 2026:** Dictionary value creation added. Create missing values for dictionary attributes and use their IDs when setting product attributes.
- <span class="badge-new">New</span> **May 2026:** Category node creation added. Create missing onboarding categories after checking the existing catalog tree.
- <span class="badge-new">New</span> **May 2026:** Product attribute value writes added. Set mapped attribute values on products after the onboarding mapping is approved.
- <span class="badge-new">New</span> **May 2026:** Simple attribute definition creation added. Create missing onboarding attributes with name, data type, and optional unit after confirmation.
- <span class="badge-new">New</span> **May 2026:** Product placement and rename tools added. Assign existing products to catalog categories and update product names after confirmation.
- <span class="badge-new">New</span> **May 2026:** Product data onboarding support added. Ask Claude to map incoming product fields to existing attributes and categories before creating anything.
- <span class="badge-new">New</span> **April 2026:** "Copy page as Markdown" added. Copy the full documentation including example conversations, view it as plain text, or open it in Claude directly from the page.
- <span class="badge-new">New</span> **April 2026:** `get_product_image` added. Ask Claude to show a product image directly in chat and it fetches it from the Bluestone CDN and provides a direct link.
```
