"""Scrape TCGPlayer Pokemon finance articles for market intelligence.

TCGPlayer is a JS SPA but serves pre-rendered HTML to Googlebot.
We use Googlebot user-agent to get article content, and the sitemap
to discover article URLs.
"""

import logging
import re
import json
from datetime import datetime

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

SITEMAP_URL = "https://www.tcgplayer.com/sitemap/articles.0.xml"
BOT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Accept": "text/html",
}

# URL patterns for finance-relevant articles
FINANCE_PATTERNS = [
    "price-spike", "biggest-price", "most-expensive", "movers-and-shakers",
    "buyer-s-guide", "price-shift", "price-drop",
]


def _extract_date_from_url(url: str) -> str | None:
    """Try to extract a date from the URL like 03-11-2026 or 2026."""
    # Match MM-DD-YYYY pattern
    m = re.search(r"(\d{2})-(\d{2})-(\d{4})", url)
    if m:
        month, day, year = m.group(1), m.group(2), m.group(3)
        return f"{year}-{month}-{day}"
    return None


async def _get_article_urls_from_sitemap(client: httpx.AsyncClient, max_urls: int = 10) -> list[dict]:
    """Get Pokemon finance article URLs from TCGPlayer sitemap, sorted by date."""
    try:
        resp = await client.get(SITEMAP_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30.0)
        resp.raise_for_status()

        urls = re.findall(r"<loc>(https://www\.tcgplayer\.com/content/article/[^<]+)</loc>", resp.text)

        # Filter for Pokemon finance articles
        finance_articles = []
        for u in urls:
            u_lower = u.lower()
            if "pok" not in u_lower:
                continue
            if not any(kw in u_lower for kw in FINANCE_PATTERNS):
                continue
            # Skip Japanese-only articles
            if "japanese-pok" in u_lower:
                continue

            date = _extract_date_from_url(u)
            finance_articles.append({"url": u, "date": date or "0000-00-00"})

        # Sort by date descending (most recent first)
        finance_articles.sort(key=lambda x: x["date"], reverse=True)

        logger.info(f"Sitemap: {len(urls)} total, {len(finance_articles)} Pokemon finance articles")
        return finance_articles[:max_urls]

    except Exception as e:
        logger.warning(f"Sitemap fetch failed: {e}")
        return []


async def _fetch_article_content(client: httpx.AsyncClient, url: str) -> dict | None:
    """Fetch a single article using Googlebot UA for pre-rendered content."""
    try:
        resp = await client.get(url, headers=BOT_HEADERS, timeout=20.0)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")

        # Extract title
        title = ""
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text(strip=True)

        # Extract date from JSON-LD
        date_str = ""
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                ld = json.loads(script.string)
                if "datePublished" in ld:
                    date_str = ld["datePublished"][:10]
                    break
            except Exception:
                pass

        # Extract article body
        content = ""
        article = soup.find("article")
        if article:
            paragraphs = article.find_all(["p", "h2", "h3"])
            clean_paras = []
            for p in paragraphs:
                text = p.get_text(strip=True)
                if not text:
                    continue
                # Skip price chart data lines (e.g. "12/13 to 12/15$250.78")
                if re.match(r"^\d+/\d+", text):
                    continue
                # Skip very short price-only labels
                if len(text) < 20 and "$" in text:
                    continue
                # Skip "Buy Product" button text
                if text in ("Buy Product", "Copy Link"):
                    continue
                clean_paras.append(text)
            content = "\n".join(clean_paras)

        if not content:
            return None

        # Truncate to keep token budget reasonable
        if len(content) > 3000:
            content = content[:3000] + "..."

        return {
            "title": title,
            "date": date_str,
            "url": url,
            "content": content,
        }

    except Exception as e:
        logger.warning(f"Failed to fetch article {url}: {e}")
        return None


async def fetch_tcgplayer_articles(max_articles: int = 4) -> list[dict]:
    """Fetch recent TCGPlayer Pokemon finance articles.

    Returns list of {title, date, url, content} dicts, most recent first.
    """
    articles = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        # Get article URLs from sitemap (already sorted by date desc)
        url_infos = await _get_article_urls_from_sitemap(client, max_urls=max_articles * 2)

        if not url_infos:
            logger.warning("No article URLs found from sitemap")
            return []

        for info in url_infos:
            if len(articles) >= max_articles:
                break
            article = await _fetch_article_content(client, info["url"])
            if article:
                articles.append(article)
                logger.info(f"Fetched article: {article['title']}")

    return articles


def format_articles_for_prompt(articles: list[dict]) -> str:
    """Format articles into a prompt section for the trader agent."""
    if not articles:
        return ""

    sections = []
    for i, art in enumerate(articles, 1):
        sections.append(
            f"### Article {i}: {art['title']}\n"
            f"Date: {art['date']}\n"
            f"Source: TCGPlayer\n\n"
            f"{art['content']}"
        )

    return (
        "## MARKET INTELLIGENCE — TCGPlayer Articles\n"
        "These are recent finance articles from TCGPlayer's expert analysts. "
        "They contain real-time market intelligence about which cards are spiking, "
        "why prices are moving, and what catalysts are driving the market. "
        "Cross-reference these mentions with our price data and factor this "
        "external intelligence into your recommendations.\n\n"
        + "\n\n---\n\n".join(sections)
    )
