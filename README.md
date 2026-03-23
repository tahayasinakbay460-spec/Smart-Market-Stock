**🛒 Smart Market Stock**

<p align="center">
  <img src="Screenshot 2026-03-12 202700.png" width="45%" alt="AI Person Detection" />
</p>
**Smart Inventory & Expiration Date Manager**
This project is a Python Flask-based inventory management system designed for small businesses.
It focuses on solving the two biggest problems in retail: stock shortages and expired products.

🚀 Key Features

Smart Expiration Tracking: Automatically categorizes products as Normal, Critical, or Expired based on their dates.
Telegram Notifications: Sends real-time alerts via Telegram Bot API when stock levels drop below a critical threshold (≤ 5).
Automated Data Entry: Integrated with Open Food Facts API to fetch product details automatically by scanning barcodes.
Bulk Import: Supports CSV file uploads for quick inventory setup.
Action Logs: Tracks every stock change with timestamps to maintain a clear history.

🏗️ Technical Architecture

- **Backend:** Flask (Python 3.11) with a RESTful approach.
- **Database:** SQLite with relational modeling for inventory and logging.
- **External API:** Integrated with **Open Food Facts API** for automated product metadata retrieval via barcode.
- **Notifications:** Real-time stock alerts powered by **Telegram Bot API**.
  
🛠 Tech Stack

Backend: Python 3.11 / Flask (RESTful Architecture)
Frontend: Vanilla JavaScript (Fetch API) / Bootstrap 5
Database: SQLite (Relational modeling with log tracking)
Integrations: Telegram API / Open Food Facts API

⚙️ Quick Start

Install dependencies: pip install -r requirements.txt
Environment Setup: Add your API keys to the .env file.
Run the app: python app.py
Access: Open http://localhost:5000 in your browser.

📝 Roadmap (Upcoming Updates)

*Multi-user authentication and role-based access control.
*AI-powered stock prediction based on sales history.
*Mobile-friendly UI optimization.
