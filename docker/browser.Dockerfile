# Playwright browser sidecar (optional remote debugging target)
FROM mcr.microsoft.com/playwright:v1.51.0-jammy
ENV BROWSER_HEADLESS=true
WORKDIR /session
CMD ["sleep", "infinity"]
