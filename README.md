# Repeato

The project is separated into three top-level folders:

- `frontend/` — React and Vite web app.
- `backend/` — Node.js and Express API, authentication, and API tests.
- `database/` — SQL schema and local SQLite data.

## Run locally

From this project root:

```powershell
npm install
npm run dev
```

Open the frontend at http://localhost:5173. The Node API runs at http://localhost:3001.

Other commands:

```powershell
npm test
npm run build
npm start
```

## Deploy on Render

1. Push this project to a GitHub repository.
2. In Render, choose **New > Blueprint**, connect the repository, and apply the `render.yaml` configuration.
3. Wait for the build and deploy to finish, then open the generated `onrender.com` URL.

The Blueprint builds the React frontend and serves it with the API from one free web service, and generates `JWT_SECRET`. It stores SQLite under `/tmp` because free Render instances do not include a persistent disk. **Data is temporary and can be lost when the service restarts or sleeps.** Use paid persistent storage or a managed database before relying on this deployment for real customer accounts, points, or orders.

To enable Razorpay, add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` as environment variables in the Render service, using Test Mode credentials first. Keep both values server-side and never put them in frontend variables.

The SQLite database is created at `database/data/repeato.sqlite` on first API startup. The initial business and starter rewards are seeded automatically. Set `JWT_SECRET` to a strong random value before production use.

For local configuration, copy `.env.example` to `.env` in this project root and set your own `JWT_SECRET`. To enable Razorpay, set the server-only `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from your Razorpay **Test Mode** dashboard; never add the secret to frontend code or commit it. Relative `DATABASE_PATH` values are resolved from this root.

Razorpay Checkout uses Test Mode only when test credentials are configured. The backend test suite mocks Razorpay order creation, payment capture, signature verification, and refunds; complete a real sandbox checkout with your Test Mode account before switching to live credentials.

## Deploy on Vercel

The root `vercel.json` builds the frontend and exposes the Express API as a Vercel Function. Set the Vercel project's **Root Directory** to the repository root. The API uses a SQLite file under `/tmp`; on Vercel this is temporary, instance-local storage. **Accounts, sessions, points, rewards, and orders can disappear or differ between function instances. This deployment is for demos only, not production data.** Use a persistent database before relying on it.

Passwords are hashed with bcrypt; successful sign-ins upgrade older hashes to the current work factor.

## Available features

- Customers can sign up with their name, email, and password after selecting a restaurant—no QR code is required. Restaurant QR and referral links can preselect the business. Customers can sign in, review points and activity, redeem rewards, manage their profile, and delete their account.
- Customers can discover restaurants, open any available menu, and order from a restaurant independently of their rewards account's linked restaurant. A cart contains dishes from one restaurant at a time.
- Customers can share a tracked referral link; the referrer and new customer each receive 20 bonus points after successful signup.
- Customers request a visit from the dashboard or scan the business QR code. Visit requests stay pending until the business owner approves them; approval awards the configured points.
- Owners can review customers and pending visits, approve visits, manage rewards, and add dishes with photos (automatically optimized on upload), categories, descriptions, dietary and spice labels, allergens, sizes and prices, and availability. They can also configure the business name, points per visit, and an optional external menu link.
- Customers can browse available restaurant dishes and size variants, choose pickup or delivery, and pay by cash or Razorpay. Delivery requires a customer address/location and restaurant coordinates. The default fee is free within 5 km, then ₹20 plus ₹10 per additional kilometer, estimated using straight-line distance.
- Orders are priced from the restaurant's menu on the server. Razorpay payments are verified and captured server-side; paid orders reach the restaurant, and rejecting a paid order triggers a refund. Restaurant owners can accept, prepare, and mark orders ready from the auto-refreshing Orders dashboard.
- Owners can set a restaurant location, create one-time delivery partner invitations, disable partner accounts, and assign ready delivery orders. Partners register using their invite link, sign in, see only assigned orders, and confirm delivery. Share invite links directly; this project does not send invitation email.
- The QR and NFC page generates a printable counter QR. Writing an NFC tag requires a compatible browser/device and NFC permission; the tag opens the same visit-request flow.
- Customer camera QR scanning uses browser QR detection and camera permission. NFC reading/writing needs a compatible NFC device and secure browser context; QR links remain the fallback.
- Theme and customer notification preferences are saved. Visit updates can appear as browser notifications when the customer grants permission.
