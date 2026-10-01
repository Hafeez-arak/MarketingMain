# Connecting a company's website

There is no "connect website" button. The **Website** tab on the Analytics
page reads two Google products for whichever site the company's Brand Brain
names, using one Google service account that belongs to this app. Connecting a
website therefore means two things: telling the Brand Brain which site, and
telling Google that the app may read it.

The service account, used in every step below:

```
search-console-reader@arak-marketing.iam.gserviceaccount.com
```

`docs/GA4-SETUP.md` is the longer account of how this was first done for Arak.
This page is the short version for any other company.

## The two fields

Both are in **Brand Brain → Knowledge Centre**.

| Field | What goes in it |
|---|---|
| Website (Search Console property) | The site address with no `https://` and no `www`, for example `ghusnsa.com` |
| Google Analytics Property ID | The digits-only Property ID, for example `123456789` |

A company whose Brand Brain has no such fields can be given them from the
Brand Brain page (add a field with the key `website` or `ga4_property_id`).

## Half one: Google Search Console

What people searched for, where the site ranked, and whether they clicked.

1. In [Search Console](https://search.google.com/search-console), add the
   site as a **Domain** property and verify it. This needs access to the
   domain's DNS, so it is done by whoever controls the domain.
2. **Settings → Users and permissions → Add user**: the service account above,
   permission **Full**.
3. Put the bare address in the Website field.

Search Console keeps its own history, so numbers appear as soon as step 2 is
done, including for the weeks before it.

## Half two: Google Analytics

Who arrived, from where, what they read, and whether they got in touch.

1. In [Google Analytics](https://analytics.google.com), create a property for
   the site with a **Web** data stream. Time zone Riyadh, currency SAR.
2. Put the tag it gives you (the `G-…` snippet) on every page of the website.
   Nothing is collected until this is live, and Analytics cannot fill in the
   days before it.
3. **Admin → Property access management → Add users**: the service account
   above, role **Viewer**.
4. **Admin → Property settings**: copy the **Property ID** (digits only, not
   the `G-` id) into the Google Analytics Property ID field.

## What the tab shows meanwhile

Each half reports on its own. A half with nothing configured shows setup
steps; a half that is configured but refused by Google shows Google's error; a
new Analytics tag shows "collecting since …" until its first day enters the
window. None of them shows a zero it has not measured.

## Ghusn, as of 2026-10-01

- Website field: `ghusnsa.com` (set).
- Search Console: the service account has not been added yet.
- Google Analytics: the live site carries no Analytics tag, so there is no
  property to connect. The rebuilt site in the `ghusn website` repository has
  none either.
