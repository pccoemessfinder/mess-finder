# Bhojan Setu

Website (`public/`) + API (`server.js`) + MongoDB Atlas. **One Render web service serves both**, so the
website must be opened from the Render URL (GitHub Pages alone cannot run the API).

## Folder layout (this is what goes on GitHub)
```
server.js
package.json
.gitignore
.env.example
README.md
public/        <- index.html, messes.html, dashboard.html, db.js, style.css, *.jpg ...
```
Upload the **contents of this folder** to the repository root. `public/` must sit next to `server.js`,
and must not be nested twice (not `public/public/`).

## 1. MongoDB Atlas (free database)
1. Create a free cluster at https://cloud.mongodb.com
2. Database Access -> add a user (username + password).
3. Network Access -> add IP `0.0.0.0/0` (Render's IPs change).
4. Connect -> Drivers -> copy the connection string, put your password in it and add the DB name:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/messfinder?retryWrites=true&w=majority`
   (if the password has special characters like `@` or `#`, URL-encode them, e.g. `@` -> `%40`).

## 2. GitHub
Create a repository and upload everything in this folder. `.env` is git-ignored: never upload it.

## 3. Render
1. New -> Web Service -> connect the GitHub repo.
2. Build command: `npm install`   Start command: `npm start`
3. Environment variables:
   - `MONGODB_URI` = the string from step 1
   - `JWT_SECRET` = any long random string
   - `ADMIN_USERNAME` = admin login name (default `mayuresh`)
   - `ADMIN_PASSWORD` = a NEW strong admin password
4. Deploy. Your site opens at `https://<name>.onrender.com`.
5. Every `git push` to the repo redeploys the site automatically.

Free Render services sleep after ~15 minutes idle; the first visit afterwards takes ~30-60 s.

## Run locally
```
npm install
cp .env.example .env    # fill in the values
npm start               # http://localhost:3000
```

## How it works
- **Admin** (`login.html` -> `dashboard.html`): the list is loaded from MongoDB, so it is the same on every
  device. Add, edit and delete are saved to MongoDB straight away. The owner email is the owner's login id,
  so it cannot be changed after adding. Leave the password blank when editing to keep the current one.
- **Owners** (`owner-login.html` -> `owner-dashboard.html`): can register themselves, then edit menu, photo,
  contact number, WhatsApp number, Google Maps link (or latitude, longitude) and timings. They can also delete their own mess (asks for their password).
- **Visitors**: `messes.html` shows every mess stored in MongoDB and can rate them. Every card shows the
  **Overall Rating** (average of everyone's ratings). One visitor = one rating per mess; rating again changes it.
  Ratings are stored in the mess's `reviews` list and appear on the owner and admin dashboards.
- Contact messages and suggestions are saved in the `contacts` and `suggestions` collections
  (Atlas -> Browse Collections).
- Passwords are stored hashed (bcrypt). Photos are stored in the database (resized by the owner dashboard).

- **Interactive map** (top of `messes.html`): one pin per mess (green Veg, red Non-Veg, orange both), 4 map styles,
  "Find Nearest to Me". Pins come from each mess's Google Maps link; short `maps.app.goo.gl` links are resolved by the
  server (`/api/resolve-map`) and cached in the `mapcache` collection.
- **Website Guide** button and **visitor counter** (total unique visitors + "active" in the last 90 s) appear in the
  navbar via `extras.js` / `extras.css`; visitors are stored in the `visitors` collection.

## The 16 messes are now owner accounts (nothing is hard-coded any more)
`messes.html` and `index.html` no longer contain any mess. All 16 messes live in MongoDB and are shown from there.
On the **first start** the server creates them from `seed-messes.json` (it runs only once, so a mess you delete
never comes back). Every mess has its own owner login:

| Mess | Owner email | Password |
|---|---|---|
| Patil Mess | patilmess@messfinder.com | 123456 |
| Hotel Morya & Mess | hotelmoryamess@messfinder.com | 123456 |
| Vaishnavi Lunch Mess | vaishnavilunchmess@messfinder.com | 123456 |
| Dharmaraj Hotel | dharmarajhotel@messfinder.com | 123456 |
| Vakratunda | vakratunda@messfinder.com | 123456 |
| Hotel Shivbhumi & Mess | hotelshivbhumimess@messfinder.com | 123456 |
| Payal Khanaval | payalkhanaval@messfinder.com | 123456 |
| Nagdev Hotel | nagdevhotel@messfinder.com | 123456 |
| Aaswad Hotel & Family Restaurant | aaswadhotelfamilyrestaurant@messfinder.com | 123456 |
| Hotel Aarambh | hotelaarambh@messfinder.com | 123456 |
| Christy Restaurant | christyrestaurant@messfinder.com | 123456 |
| Maitri Katta | maitrikatta@messfinder.com | 123456 |
| Swagat Gharghuti Mess | swagatgharghutimess@messfinder.com | 123456 |
| Shree Swami Samarth | shreeswamisamarth@messfinder.com | 123456 |
| Sugam Dining Hall | sugamdininghall@messfinder.com | 123456 |
| Jai Malhar Hotel & Mess | jaimalharhotelmess@messfinder.com | 123456 |

Owners log in at `owner-login.html` and should change nothing but their details; the admin can set a new
password for any owner in the admin dashboard (edit the mess and type a new password).

- **Ratings**: each mess shows one rating only, the **Overall Rating** = average of all visitors' ratings.
  One visitor = one rating per mess (rating again changes it). Ratings that visitors had already given to the old
  built-in cards were copied into the messes on the first start, so nothing is lost.
- **Today's Special** was removed everywhere (site, API, and old records).
- Photos of the 16 messes stay as files in `public/` (e.g. `morya.jpg`); owners can upload a new photo any time.
