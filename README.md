# PCCOE/DYP Mess Finder

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
- **Visitors**: `messes.html` shows the messes stored in MongoDB (under the built-in cards) and can rate
  them. Every card shows **Your Rating** (this visitor's own) and **Overall Rating** (average of everyone's).
  One visitor = one rating per mess; rating again changes it. Ratings are stored in the mess's `reviews` list
  (built-in messes: `ratings` collection) and appear on the owner and admin dashboards.
- Contact messages and suggestions are saved in the `contacts` and `suggestions` collections
  (Atlas -> Browse Collections).
- Passwords are stored hashed (bcrypt). Photos are stored in the database (resized by the owner dashboard).

## Known limitation
The original 15 messes (Patil, Morya, Vaishnavi, ...) are written directly into `messes.html` with their
own photos and weekly-menu pop-ups. They are NOT in MongoDB, so the admin dashboard cannot edit or delete
them, (their overall rating is stored in the `ratings` collection, though). Only messes added through
the dashboard or owner registration are fully editable and live-updated.
