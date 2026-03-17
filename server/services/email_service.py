import os
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
ALERT_EMAIL_FROM = os.environ.get("ALERT_EMAIL_FROM", SMTP_USER)
SITE_URL = os.environ.get("SITE_URL", "https://pokemon-card-trader.fly.dev")


def is_email_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASS)


def send_price_alert_email(
    to_email: str,
    card_name: str,
    card_id: int,
    current_price: float,
    threshold_type: str,  # "above" or "below"
    threshold_value: float,
    card_image_url: str | None = None,
) -> bool:
    """Send a price alert email. Returns True if sent successfully."""
    if not is_email_configured():
        logger.warning("SMTP not configured, skipping email alert")
        return False

    subject = f"🚨 PKMN Alert: {card_name} {'hit' if threshold_type == 'above' else 'dropped to'} ${current_price:.2f}"

    direction = "rose above" if threshold_type == "above" else "dropped below"
    color = "#00ff41" if threshold_type == "above" else "#ff1744"
    card_url = f"{SITE_URL}/card/{card_id}"

    html = f"""
    <div style="background:#000;color:#e0e0e0;font-family:'Courier New',monospace;padding:24px;max-width:500px;margin:0 auto;border:1px solid #222;">
        <div style="border-bottom:1px solid #222;padding-bottom:12px;margin-bottom:16px;">
            <span style="color:#00ff41;font-size:18px;font-weight:bold;">PKMN MARKET</span>
            <span style="color:#666;font-size:12px;float:right;">PRICE ALERT</span>
        </div>

        <div style="text-align:center;margin-bottom:16px;">
            {f'<img src="{card_image_url}" style="height:180px;border-radius:4px;" />' if card_image_url else ''}
        </div>

        <div style="font-size:16px;font-weight:bold;margin-bottom:8px;">{card_name}</div>

        <div style="background:#111;border:1px solid #333;border-radius:4px;padding:12px;margin-bottom:16px;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;margin-bottom:4px;">Current Price</div>
            <div style="color:{color};font-size:28px;font-weight:bold;">${current_price:.2f}</div>
            <div style="color:#888;font-size:12px;margin-top:4px;">
                Price {direction} your target of ${threshold_value:.2f}
            </div>
        </div>

        <a href="{card_url}" style="display:block;text-align:center;background:#00bcd4;color:#000;padding:10px;border-radius:4px;text-decoration:none;font-weight:bold;font-size:14px;">
            VIEW CARD DETAILS →
        </a>

        <div style="color:#555;font-size:10px;text-align:center;margin-top:16px;">
            This alert has been deactivated. Set a new alert on the site to receive future notifications.
        </div>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = ALERT_EMAIL_FROM
    msg["To"] = to_email

    # Plain text fallback
    text = f"{card_name} {direction} your target of ${threshold_value:.2f}. Current price: ${current_price:.2f}. View: {card_url}"
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(ALERT_EMAIL_FROM, to_email, msg.as_string())
        logger.info(f"Price alert email sent to {to_email} for {card_name}")
        return True
    except Exception as e:
        logger.error(f"Failed to send alert email to {to_email}: {e}")
        return False
