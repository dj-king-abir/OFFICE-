# LX ZISHAN SERVER

এটি একটি চালু করা যায় এমন Node.js starter project। এতে TikTok Login Kit OAuth, server-side encrypted token storage, profile display এবং অনুমোদিত scope থাকলে ভিডিও তালিকা/ভিডিও মেট্রিক্স দেখানোর বেসিক ব্যবস্থা আছে।

## কী কী লাগবে
1. TikTok for Developers অ্যাকাউন্ট: https://developers.tiktok.com/
2. একটি TikTok app তৈরি করে **Login Kit** এবং **Display API** যোগ করতে হবে।
3. `user.info.basic` ও `video.list` scope-এর অনুমোদন লাগবে।
4. একটি HTTPS ডোমেইন/হোস্টিং। লোকাল পরীক্ষার জন্য `http://localhost:3000` ব্যবহার করা যাবে।
5. Node.js 20 বা তার পরের সংস্করণ।

## লোকাল কম্পিউটারে চালানো
```bash
npm install
cp .env.example .env
```
`.env` ফাইলে TikTok Developer Portal থেকে পাওয়া `TIKTOK_CLIENT_KEY` ও `TIKTOK_CLIENT_SECRET` বসান। `SESSION_SECRET`-এ লম্বা random string এবং `TOKEN_ENCRYPTION_KEY`-এ ঠিক ৬৪ অক্ষরের hex key বসান। Key তৈরি করতে:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
TikTok Developer Portal-এর Login Kit Redirect URI-তে `.env`-এর `TIKTOK_REDIRECT_URI` হুবহু যোগ করুন। তারপর:
```bash
npm start
```
ব্রাউজারে `http://localhost:3000` খুলুন।

## নিরাপত্তা
- Client secret এবং access/refresh token কখনো browser-এ পাঠাবেন না।
- `.env` বা `data/` ফোল্ডার GitHub-এ আপলোড করবেন না।
- Production-এ HTTPS, secure session store, database backup, admin authentication, privacy policy ও terms pages যোগ করুন।
- এই starter-এর session store Express MemoryStore; production deployment-এর আগে Redis/DB-backed session store দিয়ে বদলাতে হবে।
- বর্তমানে এটি একটি TikTok account slot রাখে এবং public-facing admin login নেই। একাধিক user/admin চালুর আগে authentication, per-user database schema ও access controls যোগ করতে হবে।

## সীমাবদ্ধতা
TikTok API-তে যে scope ও endpoint আপনার app-কে অনুমোদন করা হয়েছে, শুধু সেগুলোই কাজ করবে। এই প্রকল্প কৃত্রিম followers/hearts/views তৈরি করে না, কোনো password সংগ্রহ করে না, এবং TikTok-এর private/internal API ব্যবহার করে না। Content Posting API চাইলে আলাদা product approval ও user consent নিয়ে পরের ধাপে যুক্ত করা যাবে।
