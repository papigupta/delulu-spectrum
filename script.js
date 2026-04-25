import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://agwbthntmvdkrfknmbjw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_bsGaNa7IzjwAijUj0QJwtA_vEpOFMR7";
const RESULT_REQUIREMENTS = Object.freeze({
  minimumRatings: 3,
  strongSignalRatings: 5,
});
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const domains = [
  {
    key: "capability",
    label: "Capability",
    raterPrompt: "How capable, sharp, and competent is {name} in real situations?",
    selfPrompt: "How capable, sharp, and competent are you in real situations?",
    report: "How smart, capable, or competent you seem.",
  },
  {
    key: "presence",
    label: "Social presence",
    raterPrompt: "How strong is {name}'s presence in conversation, groups, and first impressions?",
    selfPrompt: "How strong is your presence in conversation, groups, and first impressions?",
    report: "How you come across socially and in the room.",
  },
  {
    key: "physicality",
    label: "Appearance and physicality",
    raterPrompt: "How strong is {name}'s physical presentation in ordinary life?",
    selfPrompt: "How strong is your physical presentation in ordinary life?",
    report: "How your appearance and physical presence come across.",
  },
  {
    key: "steadiness",
    label: "Emotional steadiness",
    raterPrompt: "How well does {name} handle pressure, hurt, and conflict?",
    selfPrompt: "How well do you handle pressure, hurt, and conflict?",
    report: "How you handle pressure, hurt, and conflict.",
  },
  {
    key: "craft",
    label: "Work and follow-through",
    raterPrompt: "How strong are {name}'s output, taste, and follow-through?",
    selfPrompt: "How strong are your output, taste, and follow-through?",
    report: "How strong your output and follow-through seem.",
  },
];

const ratingOptions = [
  { value: 1, label: "Very low" },
  { value: 3, label: "Low" },
  { value: 5, label: "Average" },
  { value: 7, label: "High" },
  { value: 9, label: "Very high" },
];

const app = document.querySelector(".app");
const screenLabel = document.querySelector("#screen-label");
const appTitle = document.querySelector("#app-title");
const promiseEl = document.querySelector("#promise");
const view = document.querySelector("#view");
const reportTemplate = document.querySelector("#report-template");
const domainTemplate = document.querySelector("#domain-template");

window.addEventListener("popstate", route);
registerServiceWorker();
route();

async function route() {
  const params = new URLSearchParams(window.location.search);
  const ratingSession = params.get("rate");
  const ownerSession = params.get("result");
  const sharedSession = params.get("share");

  try {
    if (ratingSession) {
      await renderRater(ratingSession);
      return;
    }

    if (ownerSession) {
      await renderOwner(ownerSession, params.get("owner"));
      return;
    }

    if (sharedSession) {
      await renderSharedResult(sharedSession, params.get("view"));
      return;
    }

    renderSelfStart();
  } catch (error) {
    renderBackendError(error);
  }
}

function renderSelfStart() {
  setHeader(
    "Private test",
    "Delulu Spectrum",
    "See the gap between how you see yourself and how your people see you.",
  );

  view.innerHTML = `
    <section class="intro-panel">
      <p class="section-kicker">Start here</p>
      <h2>Rate yourself before anyone else does.</h2>
      <p>
        Pick the option that feels most true right now. Your people will answer the
        same five questions without seeing your ratings.
      </p>
    </section>

    <form class="rating-form" id="rating-form">
      <label class="name-field">
        <span>What should your people call you?</span>
        <input id="person-name" name="person-name" type="text" autocomplete="name" maxlength="36" placeholder="Your first name" />
      </label>

      <div class="question-list" id="question-list"></div>

      <button class="primary-button submit-button" type="submit" disabled>
        Get my rating link
      </button>
      <p class="helper-text">No account. Your final result is private unless you share it.</p>
    </form>
  `;

  const scores = {};
  const form = document.querySelector("#rating-form");
  const submit = form.querySelector(".submit-button");

  renderQuestions({
    target: document.querySelector("#question-list"),
    mode: "self",
    scores,
    onChange: () => {
      submit.disabled = !allAnswered(scores);
    },
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!allAnswered(scores)) {
      return;
    }

    try {
      submit.disabled = true;
      submit.textContent = "Creating link...";
      const rawName = document.querySelector("#person-name").value.trim();
      const session = await createSession(rawName || "you", scores);
      const ownerUrl = buildUrl({ result: session.id, owner: session.ownerToken });
      window.history.pushState(null, "", ownerUrl);
      await renderOwner(session.id, session.ownerToken);
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "Get my rating link";
      form.querySelector(".helper-text").textContent = getErrorMessage(error);
    }
  });
}

async function renderRater(sessionId) {
  renderLoading("Anonymous rating", "Loading rating link...");
  const session = await getRaterSession(sessionId);

  if (!session) {
    renderMissingLink();
    return;
  }

  const displayName = getRaterDisplayName(session);

  setHeader(
    "Anonymous rating",
    `Rate ${displayName}`,
    `${displayName} will only see the average after enough people respond.`,
  );

  view.innerHTML = `
    <section class="intro-panel">
      <p class="section-kicker">For ${escapeHtml(displayName)}</p>
      <h2>Help them see themselves more clearly.</h2>
      <p>
        Your name is never attached to your rating. Be honest, but rate the version
        of them you have actually seen.
      </p>
    </section>

    <form class="rating-form" id="rating-form">
      <div class="question-list" id="question-list"></div>

      <button class="primary-button submit-button" type="submit" disabled>
        Send anonymous rating
      </button>
      <p class="helper-text">${escapeHtml(displayName)} will not see individual answers.</p>
    </form>
  `;

  const scores = {};
  const form = document.querySelector("#rating-form");
  const submit = form.querySelector(".submit-button");

  renderQuestions({
    target: document.querySelector("#question-list"),
    mode: "rater",
    scores,
    personName: displayName,
    onChange: () => {
      submit.disabled = !allAnswered(scores);
    },
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!allAnswered(scores)) {
      return;
    }

    try {
      submit.disabled = true;
      submit.textContent = "Sending...";
      const updated = await addAnonymousRating(session, scores);
      renderThankYou(updated);
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "Send anonymous rating";
      form.querySelector(".helper-text").textContent = getErrorMessage(error);
    }
  });
}

async function renderOwner(sessionId, ownerToken) {
  renderLoading("Private result", "Loading your private link...");
  const session = await getOwnerSession(sessionId, ownerToken);

  if (!session) {
    renderMissingLink();
    return;
  }

  if (session.ratings.length < getMinimumResultRatings(session)) {
    renderWaiting(session);
    return;
  }

  renderReport(session, "owner");
}

async function renderSharedResult(sessionId, publicToken) {
  renderLoading("Shared result", "Loading shared result...");
  const session = await getPublicSession(sessionId, publicToken);

  if (!session) {
    renderMissingLink();
    return;
  }

  if (session.ratings.length < getMinimumResultRatings(session)) {
    renderMissingLink("This shared result is not ready yet.");
    return;
  }

  renderReport(session, "shared");
}

function renderWaiting(session) {
  const displayName = getDisplayName(session);
  const ratingUrl = buildUrl({ rate: session.id });
  const ownerUrl = buildUrl({ result: session.id, owner: session.ownerToken });
  const minimumRatings = getMinimumResultRatings(session);
  const strongSignalRatings = getStrongSignalRatings(session);
  const progress = Math.min(session.ratings.length / minimumRatings, 1) * 100;

  setHeader(
    "Private link",
    "Delulu Spectrum",
    `Ask people who know ${displayName} well enough to be honest.`,
  );

  view.innerHTML = `
    <section class="share-state">
      <p class="section-kicker">Your mirror is being built</p>
      <h2>Send this to people who know you.</h2>
      <p>
        You have ${session.ratings.length} anonymous ${pluralize(session.ratings.length, "rating")}.
        Your provisional result unlocks at ${minimumRatings}; it gets stronger at ${strongSignalRatings}+.
      </p>

      <div class="progress-block" aria-label="${session.ratings.length} of ${minimumRatings} ratings collected">
        <div class="progress-top">
          <span>${session.ratings.length}/${minimumRatings} to unlock</span>
          <span>${strongSignalRatings}+ is better</span>
        </div>
        <div class="progress-track">
          <span id="progress-fill"></span>
        </div>
      </div>

      <div class="link-box">
        <span>Rater link</span>
        <code>${escapeHtml(ratingUrl)}</code>
      </div>

      <div class="button-row">
        <button class="primary-button" type="button" id="share-rating">Share rating link</button>
        <button class="secondary-button" type="button" id="copy-rating">Copy link</button>
      </div>

      <p class="helper-text" id="share-status" role="status"></p>
    </section>

    <section class="privacy-panel compact-panel">
      <p class="section-kicker">Keep your private link</p>
      <p>
        Send it to your own WhatsApp, Notes, Telegram, or wherever you keep things.
        Friends should get the rater link above, not this page.
      </p>
      <div class="button-row">
        <button class="primary-button" type="button" id="save-owner">Save to myself</button>
        <button class="secondary-button" type="button" id="copy-owner">Copy private link</button>
        <button class="ghost-button" type="button" id="refresh-result">Check again</button>
        ${
          session.ratings.length >= minimumRatings
            ? '<button class="ghost-button" type="button" id="back-to-result">Back to result</button>'
            : ""
        }
      </div>
      <p class="helper-text" id="owner-status" role="status"></p>
    </section>
  `;

  document.querySelector("#progress-fill").style.width = `${progress}%`;
  document.querySelector("#share-rating").addEventListener("click", () => {
    shareLink({
      url: ratingUrl,
      title: "Delulu Spectrum",
      text: `${displayName} asked you to rate them anonymously.`,
      statusId: "share-status",
    });
  });
  document.querySelector("#copy-rating").addEventListener("click", () => {
    copyText(ratingUrl, "share-status", "Rater link copied.");
  });
  document.querySelector("#save-owner").addEventListener("click", () => {
    shareLink({
      url: ownerUrl,
      title: "My private Delulu Spectrum result",
      text: "Save this private result link for yourself. Do not send it to raters.",
      statusId: "owner-status",
      successMessage: "Private link shared.",
      fallbackMessage: "Private link copied.",
    });
  });
  document.querySelector("#copy-owner").addEventListener("click", () => {
    copyText(ownerUrl, "owner-status", "Private result link copied.");
  });
  document.querySelector("#refresh-result").addEventListener("click", () => {
    renderOwner(session.id, session.ownerToken);
  });

  const backToResult = document.querySelector("#back-to-result");
  if (backToResult) {
    backToResult.addEventListener("click", () => {
      renderReport(session, "owner");
    });
  }
}

function renderThankYou(session) {
  const displayName = getRaterDisplayName(session);

  setHeader(
    "Rating sent",
    "Thank you",
    "Your anonymous rating has been added to the average.",
  );

  view.innerHTML = `
    <section class="thank-you">
      <p class="section-kicker">Submitted anonymously</p>
      <h2>You helped ${escapeHtml(displayName)} get a clearer read.</h2>
      <p>
        They will only see the aggregate once enough people respond. They will not
        see your individual rating.
      </p>
      <div class="button-row">
        <button class="primary-button" type="button" id="start-own">Check my own gap</button>
      </div>
    </section>
  `;

  document.querySelector("#start-own").addEventListener("click", () => {
    window.history.pushState(null, "", buildUrl({}));
    renderSelfStart();
  });
}

function renderReport(session, context) {
  const displayName = getDisplayName(session);
  const fragment = reportTemplate.content.cloneNode(true);
  const report = buildReport(session);
  const language = getResultLanguage(report.score);
  const isOwner = context === "owner";

  setHeader(
    isOwner ? "Private result" : "Shared result",
    "Delulu Spectrum",
    isOwner
      ? "See the gap between how you see yourself and how your people see you."
      : `${displayName} chose to share this result.`,
  );

  view.replaceChildren(fragment);

  document.querySelector("#rater-count").textContent = `${session.ratings.length} anonymous ${pluralize(session.ratings.length, "rating")}`;
  document.querySelector("#threshold-label").textContent =
    session.ratings.length >= getStrongSignalRatings(session) ? "Strong signal" : "Minimum met";
  document.querySelector("#score").textContent = formatSigned(report.score);
  document.querySelector("#result-title").textContent = language.title;
  document.querySelector("#interpretation").textContent = language.interpretation;
  document.querySelector("#note").textContent = language.note;

  setHorizontalPosition(document.querySelector("#score-marker"), report.score, -10, 10);
  renderDomains(report.domains);

  const actions = document.querySelector("#result-actions");
  if (isOwner) {
    actions.hidden = false;
    document.querySelector("#share-result").addEventListener("click", async () => {
      try {
        setStatus("result-share-status", "Creating share link...");
        const updated = await ensurePublicToken(session);
        const publicUrl = buildUrl({ share: updated.id, view: updated.publicToken });
        await shareLink({
          url: publicUrl,
          title: "My Delulu Spectrum result",
          text: `My Delulu Spectrum gap is ${formatSigned(report.score)}.`,
          statusId: "result-share-status",
        });
      } catch (error) {
        setStatus("result-share-status", getErrorMessage(error));
      }
    });
    document.querySelector("#ask-more").addEventListener("click", () => {
      renderWaiting(session);
    });
  }
}

function renderDomains(reportDomains) {
  const domainList = document.querySelector("#domain-list");
  domainList.replaceChildren();

  reportDomains.forEach((domain) => {
    const row = domainTemplate.content.firstElementChild.cloneNode(true);
    const gap = domain.self - domain.peer;
    const start = Math.min(domain.self, domain.peer);
    const end = Math.max(domain.self, domain.peer);

    row.querySelector("h3").textContent = domain.label;
    row.querySelector(".domain-copy p").textContent = domain.report;
    row.querySelector(".gap-pill").textContent = formatSigned(gap);

    const range = row.querySelector(".range-wrap");
    range.setAttribute(
      "aria-label",
      `${domain.label}: you rated ${domain.self.toFixed(1)}, your people averaged ${domain.peer.toFixed(1)}, gap ${formatSigned(gap)}.`,
    );

    const fill = row.querySelector(".gap-fill");
    fill.style.left = `${scoreToPercent(start, 0, 10)}%`;
    fill.style.width = `${scoreToPercent(end - start, 0, 10)}%`;

    setHorizontalPosition(row.querySelector(".peer-dot"), domain.peer);
    setHorizontalPosition(row.querySelector(".self-dot"), domain.self);

    domainList.append(row);
  });
}

function renderQuestions({ target, mode, scores, personName = "them", onChange }) {
  target.replaceChildren();

  domains.forEach((domain, index) => {
    const question = document.createElement("section");
    question.className = "rating-question";

    const copy = document.createElement("div");
    copy.className = "question-copy";

    const kicker = document.createElement("p");
    kicker.className = "section-kicker";
    kicker.textContent = `0${index + 1}`;

    const title = document.createElement("h2");
    title.textContent = domain.label;

    const prompt = document.createElement("p");
    prompt.textContent =
      mode === "self" ? domain.selfPrompt : domain.raterPrompt.replace("{name}", personName);

    copy.append(kicker, title, prompt);

    const choiceRow = document.createElement("div");
    choiceRow.className = "choice-row";
    choiceRow.setAttribute("role", "radiogroup");
    choiceRow.setAttribute("aria-label", domain.label);

    ratingOptions.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.dataset.value = String(option.value);
      button.setAttribute("aria-pressed", "false");
      button.textContent = option.label;
      button.addEventListener("click", () => {
        scores[domain.key] = option.value;
        choiceRow.querySelectorAll(".choice-button").forEach((choice) => {
          choice.setAttribute("aria-pressed", String(choice === button));
        });
        onChange();
      });
      choiceRow.append(button);
    });

    question.append(copy, choiceRow);
    target.append(question);
  });
}

async function createSession(name, selfScores) {
  const session = {
    id: randomId("s"),
    owner_token: randomId("o"),
    public_token: null,
    name: sanitizeName(name),
    self_scores: { ...selfScores },
  };

  const { error } = await supabase.from("sessions").insert(session);

  if (error) {
    throw error;
  }

  return normalizeSession(session, []);
}

async function addAnonymousRating(session, scores) {
  const rating = {
    id: randomId("r"),
    session_id: session.id,
    scores: { ...scores },
  };

  const { error } = await supabase.from("ratings").insert(rating);

  if (error) {
    throw error;
  }

  return {
    ...session,
    ratings: [...(session.ratings || []), normalizeRating(rating)],
  };
}

async function ensurePublicToken(session) {
  if (session.publicToken) {
    return session;
  }

  const publicToken = randomId("p");
  const { data, error } = await supabase.rpc("publish_result", {
    p_session_id: session.id,
    p_owner_token: session.ownerToken,
    p_public_token: publicToken,
  });

  if (error) {
    throw error;
  }

  if (!data?.public_token) {
    throw new Error("Could not create public result link.");
  }

  return {
    ...session,
    publicToken: data.public_token,
  };
}

function buildReport(session) {
  const reportDomains = domains.map((domain) => {
    const peerScores = session.ratings.map((rating) => rating.scores[domain.key]);
    return {
      ...domain,
      self: session.selfScores[domain.key],
      peer: average(peerScores),
    };
  });

  return {
    score: average(reportDomains.map((domain) => domain.self - domain.peer)),
    domains: reportDomains,
  };
}

function getResultLanguage(score) {
  if (score >= 4) {
    return {
      title: "Your self-view is meaningfully higher than how your raters see you.",
      interpretation:
        "A positive gap means you rated yourself above the average of your people. This does not make them right. It means your self-image is ahead of how you are being perceived.",
      note:
        "The useful question is not whether to believe them completely. It is where your confidence may be moving faster than the evidence people close to you can see.",
    };
  }

  if (score >= 1.5) {
    return {
      title: "Your self-view is a little ahead of how your raters see you.",
      interpretation:
        "A small positive gap can be useful when belief helps you act. It becomes risky only when the gap stops responding to evidence.",
      note:
        "Keep the positive tilt, but keep it tied to what people can actually see you doing.",
    };
  }

  if (score > -1.5) {
    return {
      title: "Your self-view mostly matches how your raters see you.",
      interpretation:
        "A small gap means your self-rating and your people's average are close. That does not make the result objective truth, but it is a useful calibration signal.",
      note:
        "This is close to calibrated. The work is to keep looking directly instead of turning the result into a fixed identity.",
    };
  }

  if (score > -4) {
    return {
      title: "Your people see more in you than you seem to see in yourself.",
      interpretation:
        "A negative gap means you rated yourself below the average of your people. The mirror is not saying you are broken. It is saying your self-view may be smaller than your visible life.",
      note:
        "Let the positive signal land before you explain it away. Sometimes the distortion is not grandiosity. Sometimes it is refusal to register evidence.",
    };
  }

  return {
    title: "Your raters see much more in you than you see in yourself.",
    interpretation:
      "A large negative gap means your self-rating sits well below the average of your people. This is the correction cage pattern.",
    note:
      "The gap is still not objective truth. But if several people see the same thing, it is worth treating that as evidence instead of politeness.",
  };
}

function renderMissingLink(message = "This link is not available.") {
  setHeader(
    "Link unavailable",
    "Delulu Spectrum",
    "The link may be wrong, expired, or missing the right private token.",
  );

  view.innerHTML = `
    <section class="missing-state">
      <p class="section-kicker">Nothing to show</p>
      <h2>${escapeHtml(message)}</h2>
      <p>
        Start a new private test here, or check that the link was copied completely.
      </p>
      <div class="button-row">
        <button class="primary-button" type="button" id="start-over">Start new test</button>
      </div>
    </section>
  `;

  document.querySelector("#start-over").addEventListener("click", () => {
    window.history.pushState(null, "", buildUrl({}));
    renderSelfStart();
  });
}

function renderLoading(label, message) {
  setHeader(label, "Delulu Spectrum", "One second.");

  view.innerHTML = `
    <section class="missing-state">
      <p class="section-kicker">Loading</p>
      <h2>${escapeHtml(message)}</h2>
    </section>
  `;
}

function renderBackendError(error) {
  setHeader("Backend error", "Delulu Spectrum", "Something did not save or load correctly.");

  view.innerHTML = `
    <section class="missing-state">
      <p class="section-kicker">Supabase issue</p>
      <h2>${escapeHtml(getErrorMessage(error))}</h2>
      <p>
        This usually means one SQL function or policy is missing. Send me this screen
        if you are not sure what happened.
      </p>
      <div class="button-row">
        <button class="primary-button" type="button" id="start-over">Start new test</button>
      </div>
    </section>
  `;

  document.querySelector("#start-over").addEventListener("click", () => {
    window.history.pushState(null, "", buildUrl({}));
    renderSelfStart();
  });
}

function setHeader(label, title, promise) {
  app.classList.add("is-switching");
  screenLabel.textContent = label;
  appTitle.textContent = title;
  promiseEl.textContent = promise;
  window.setTimeout(() => app.classList.remove("is-switching"), 90);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function allAnswered(scores) {
  return domains.every((domain) => Number.isFinite(scores[domain.key]));
}

function getMinimumResultRatings(session) {
  return normalizePositiveInteger(session?.minimumRatings, RESULT_REQUIREMENTS.minimumRatings);
}

function getStrongSignalRatings(session) {
  const minimumRatings = getMinimumResultRatings(session);

  return Math.max(
    minimumRatings,
    normalizePositiveInteger(session?.strongSignalRatings, RESULT_REQUIREMENTS.strongSignalRatings),
  );
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(1, Math.floor(number));
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatSigned(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

function scoreToPercent(value, min, max) {
  return ((clamp(value, min, max) - min) / (max - min)) * 100;
}

function setHorizontalPosition(el, value, min = 0, max = 10) {
  el.style.left = `${scoreToPercent(value, min, max)}%`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getDisplayName(session) {
  return session.name === "you" ? "you" : session.name;
}

function getRaterDisplayName(session) {
  return session.name === "you" ? "this person" : session.name;
}

function sanitizeName(name) {
  return name.replace(/\s+/g, " ").trim().slice(0, 36) || "you";
}

function pluralize(count, word) {
  return `${word}${count === 1 ? "" : "s"}`;
}

function buildUrl(params) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

async function shareLink({
  url,
  title,
  text,
  statusId,
  successMessage = "Shared.",
  fallbackMessage = "Link copied.",
}) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      setStatus(statusId, successMessage);
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
    }
  }

  copyText(url, statusId, fallbackMessage);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      // The app still works without PWA support.
    });
  });
}

async function copyText(text, statusId, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(statusId, successMessage);
  } catch (error) {
    window.prompt("Copy this link:", text);
    setStatus(statusId, "Copy the link from the dialog.");
  }
}

function setStatus(id, message) {
  const status = document.querySelector(`#${id}`);

  if (status) {
    status.textContent = message;
  }
}

async function getOwnerSession(sessionId, ownerToken) {
  const { data, error } = await supabase.rpc("get_owner_session", {
    p_session_id: sessionId,
    p_owner_token: ownerToken,
  });

  if (error) {
    throw error;
  }

  return normalizeSessionPayload(data);
}

async function getPublicSession(sessionId, publicToken) {
  const { data, error } = await supabase.rpc("get_public_session", {
    p_session_id: sessionId,
    p_public_token: publicToken,
  });

  if (error) {
    throw error;
  }

  return normalizeSessionPayload(data);
}

async function getRaterSession(sessionId) {
  const { data, error } = await supabase.rpc("get_rater_session", {
    p_session_id: sessionId,
  });

  if (!error && data) {
    return normalizeSession({ id: data.id, name: data.name }, []);
  }

  return {
    id: sessionId,
    name: "this person",
    ratings: [],
  };
}

function normalizeSessionPayload(data) {
  if (!data?.session) {
    return null;
  }

  return normalizeSession(data.session, data.ratings || []);
}

function normalizeSession(session, ratings = []) {
  return {
    id: session.id,
    ownerToken: session.owner_token || session.ownerToken || "",
    publicToken: session.public_token || session.publicToken || "",
    name: session.name || "you",
    selfScores: session.self_scores || session.selfScores || {},
    minimumRatings: session.minimum_ratings || session.minimumRatings || null,
    strongSignalRatings: session.strong_signal_ratings || session.strongSignalRatings || null,
    ratings: ratings.map(normalizeRating),
    createdAt: session.created_at || session.createdAt || "",
  };
}

function normalizeRating(rating) {
  return {
    id: rating.id,
    scores: rating.scores || {},
    createdAt: rating.created_at || rating.createdAt || "",
  };
}

function getErrorMessage(error) {
  if (!navigator.onLine) {
    return "You seem to be offline. Try again when the internet is back.";
  }

  if (error?.message) {
    return error.message;
  }

  return "Something went wrong. Try again.";
}

function randomId(prefix) {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(8);
    window.crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("");
    return `${prefix}_${token}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };

    return entities[char];
  });
}
