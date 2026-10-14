# Make the Show workbook delivery

How the free workbook reaches readers, so nobody breaks it by accident again.

## Flow

1. The homepage "Get the free workbook" button and card link to `/workbook/` (`public/workbook/index.html`).
2. The form posts the email to the newsletter Worker's `/api/subscribe`
   (`seasoned-tech-newsletter.mike-663.workers.dev`), the same endpoint the homepage
   newsletter forms use. That adds the reader to the Seasoned.Tech Brevo list and
   emails Mike a signup notice.
3. On success the page sends the reader to `/workbook/thank-you` (`public/workbook/thank-you.html`).
4. The download button hits `/download/make-the-show-workbook`, which `src/index.js`
   streams from the private R2 bucket `thatmikehamilton-downloads`
   (object `make-the-show-workbook.pdf`, bound as `DOWNLOADS` in `wrangler.toml`).

## Rules

- Deploy this site only by pushing to `main` (Workers Builds). Do not run `wrangler deploy`
  from any other folder or sandbox. A stale deploy on Sep 22, 2026 wiped the Bookshelf.
- No Cloudflare zone route should send `/download/*` or `/workbook*` on thatmikehamilton.com
  to the newsletter Worker. The site Worker owns them.
- `scripts/verify-live-site-assets.mjs` checks the download every 6 hours. If it fails,
  the "Website book-cover health check" GitHub issue gets a new comment.

## History

- Jul to Aug 2026: the newsletter Worker served the workbook page, signup, and an emailed,
  signed download link.
- Sep 5, 2026: a newsletter Worker rebuild dropped all of that and left redirects that
  looped back to themselves. The button went to a 404 from then on.
- Oct 14, 2026: rebuilt here as an instant download after email signup.
