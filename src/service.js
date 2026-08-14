import { GuideSnapshot, TournamentDetail } from './models.js';
import { StartGGError } from './startgg.js';
import { addLocalDays, localDayStart, weekBounds } from './time.js';

const CONCLUSION_GRACE_SECONDS = 4 * 60 * 60;
const COMPACT_TOURNAMENT_SPAN_SECONDS = 7 * 24 * 60 * 60;

function timestampWithin(timestamp, start, end) {
  if (!timestamp) return false;
  const startTs = Math.floor(start.getTime() / 1000);
  const endTs = Math.floor(end.getTime() / 1000);
  return timestamp >= startTs && timestamp < endTs;
}

export class GuideService {
  constructor(config, startgg, logger = console, broadcastResolver = null) {
    this.config = config;
    this.startgg = startgg;
    this.logger = logger;
    this.broadcastResolver = broadcastResolver;
    this.selected = [];
    this.lastDiscoveryAt = null;
    this.lastGoodSnapshot = null;
  }

  weekBounds(now) {
    return weekBounds(now, this.config.displayTimeZone);
  }

  static overlaps(summary, start, end) {
    const startTs = Math.floor(start.getTime() / 1000);
    const endTs = Math.floor(end.getTime() / 1000);
    return summary.endAt >= startTs && summary.startAt < endTs;
  }

  tournamentTimeZone(summary) {
    const candidate = summary.timezone || this.config.displayTimeZone;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
      return candidate;
    } catch {
      return this.config.displayTimeZone;
    }
  }

  eventScheduleBounds(summary) {
    const timestamps = (summary.events ?? [])
      .map((event) => Number(event.startAt))
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);

    if (!timestamps.length) return null;
    return [Math.min(...timestamps), Math.max(...timestamps)];
  }

  isSeriesContainer(summary) {
    const tournamentSpan = Math.max(0, (summary.endAt || 0) - (summary.startAt || 0));
    if (tournamentSpan > COMPACT_TOURNAMENT_SPAN_SECONDS) return true;

    const eventBounds = this.eventScheduleBounds(summary);
    if (!eventBounds) return false;

    const [firstEvent, lastEvent] = eventBounds;
    if (lastEvent - firstEvent > COMPACT_TOURNAMENT_SPAN_SECONDS) return true;

    // Reused tournament/series pages sometimes have a current tournament date
    // but retain Smash events scheduled months or years away from that date.
    // Treat that as a series container even if the tournament's own start/end
    // metadata was later edited to a short current window.
    if (
      summary.startAt &&
      (Math.abs(firstEvent - summary.startAt) > COMPACT_TOURNAMENT_SPAN_SECONDS ||
        Math.abs(lastEvent - summary.startAt) > COMPACT_TOURNAMENT_SPAN_SECONDS)
    ) {
      return true;
    }

    return false;
  }

  needsFullEventSchedule(summary, weekStart, weekEnd) {
    if (this.isSeriesContainer(summary)) return true;

    const events = summary.events ?? [];
    // Discovery samples at most eight Smash events per tournament. If all
    // eight slots are occupied, assume the list may be truncated and hydrate
    // the complete event schedule before judging bracket size.
    if (events.length >= 8) return true;

    // An event outside this week is a strong sign that the tournament page is
    // being reused, so hydrate its full Smash schedule before deciding whether
    // it belongs on the guide.
    return events.some(
      (event) => event.startAt && !timestampWithin(event.startAt, weekStart, weekEnd),
    );
  }

  relevantWeekEvents(summary, weekStart, weekEnd, now = null) {
    const events = summary.events ?? [];
    if (!this.isSeriesContainer(summary)) return events;

    let relevant = events.filter((event) => timestampWithin(event.startAt, weekStart, weekEnd));

    if (now) {
      const timeZone = this.tournamentTimeZone(summary);
      const todayStart = localDayStart(now, timeZone);
      const todayStartTs = Math.floor(todayStart.getTime() / 1000);

      // A reused series page can contain multiple brackets from the same week.
      // Once a bracket is in the past, it must not keep the series notable or
      // inflate the entrant count for a later bracket. Only current/upcoming,
      // non-completed brackets remain relevant.
      relevant = relevant.filter((event) => {
        const state = String(event.state ?? '').toUpperCase();
        return state !== 'COMPLETED' && Number(event.startAt) >= todayStartTs;
      });
    }

    return relevant;
  }

  relevantTodayEvents(summary, now) {
    const events = summary.events ?? [];
    if (!this.isSeriesContainer(summary)) return events;

    const timeZone = this.tournamentTimeZone(summary);
    const dayStart = localDayStart(now, timeZone);
    const dayEnd = addLocalDays(dayStart, 1, timeZone);
    return events.filter((event) => {
      const state = String(event.state ?? '').toUpperCase();
      return state !== 'COMPLETED' && timestampWithin(event.startAt, dayStart, dayEnd);
    });
  }

  isToday(summary, now) {
    // Compact tournaments can genuinely span multiple days, so their whole
    // scheduled tournament window counts as "today". Reused series/container
    // pages only count as today when a Smash event itself is scheduled today.
    if (this.isSeriesContainer(summary)) {
      return this.relevantTodayEvents(summary, now).length > 0;
    }

    const timeZone = this.tournamentTimeZone(summary);
    const dayStart = localDayStart(now, timeZone);
    const dayEnd = addLocalDays(dayStart, 1, timeZone);
    return GuideService.overlaps(summary, dayStart, dayEnd);
  }

  isConcluded(summary, now) {
    const events = summary.events ?? [];
    const allSmashEventsCompleted =
      events.length > 0 &&
      events.every((event) => String(event.state ?? '').toUpperCase() === 'COMPLETED');

    if (allSmashEventsCompleted) return true;

    const nowTs = Math.floor(now.getTime() / 1000);
    const hasRealScheduledEnd = summary.endAt > summary.startAt;

    if (hasRealScheduledEnd && nowTs >= summary.endAt + CONCLUSION_GRACE_SECONDS) {
      return true;
    }

    return false;
  }

  notabilityMetrics(summary, events = summary.events ?? []) {
    const maxEntrants = events.reduce(
      (max, event) => Math.max(max, Number(event.numEntrants) || 0),
      0,
    );
    const hasEntrantData = events.some((event) => (Number(event.numEntrants) || 0) > 0);
    const hasCompetitionTier = events.some((event) => event.competitionTier != null);

    return { maxEntrants, hasEntrantData, hasCompetitionTier };
  }

  hasListedLocation(summary) {
    return [summary.city, summary.addrState, summary.countryCode].some(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
  }

  entrantThreshold(summary) {
    return this.hasListedLocation(summary)
      ? this.config.minNotableOfflineEntrants
      : this.config.minNotableOnlineEntrants;
  }

  isNotable(summary, events = summary.events ?? []) {
    if (!events.length) return false;

    const metrics = this.notabilityMetrics(summary, events);
    if (metrics.maxEntrants >= this.entrantThreshold(summary)) return true;

    // Tournament-wide attendance is useful only as a fallback when start.gg
    // has no event entrant count at all. It is intentionally ignored for
    // series/reused pages because that attendance may span many brackets.
    if (
      !metrics.hasEntrantData &&
      !this.isSeriesContainer(summary) &&
      summary.numAttendees >= this.config.minNotableAttendees
    ) {
      return true;
    }

    // competitionTier can help rank already-qualified tournaments, but its mere
    // presence no longer makes a small bracket notable.
    return false;
  }

  compareRank(a, b) {
    const aMetrics = this.notabilityMetrics(a.summary, a.events);
    const bMetrics = this.notabilityMetrics(b.summary, b.events);
    return (
      Number(bMetrics.hasCompetitionTier) - Number(aMetrics.hasCompetitionTier) ||
      bMetrics.maxEntrants - aMetrics.maxEntrants ||
      b.summary.numAttendees - a.summary.numAttendees ||
      a.summary.startAt - b.summary.startAt
    );
  }

  async hydrateSuspiciousSchedules(summaries, weekStart, weekEnd) {
    if (typeof this.startgg.getTournamentSummary !== 'function') return summaries;

    const results = await Promise.allSettled(
      summaries.map(async (summary) => {
        if (!this.needsFullEventSchedule(summary, weekStart, weekEnd)) return summary;
        return this.startgg.getTournamentSummary(summary.id);
      }),
    );

    return summaries.map((summary, index) => {
      const result = results[index];
      if (result.status === 'fulfilled') return result.value;
      this.logger.warn(
        `Could not load full event schedule for ${summary.id}: ${result.reason?.message ?? result.reason}`,
      );
      return summary;
    });
  }

  weeklyCandidate(summary, weekStart, weekEnd, now) {
    const events = this.relevantWeekEvents(summary, weekStart, weekEnd, now);
    return { summary, events };
  }

  todayCandidate(summary, now) {
    const events = this.relevantTodayEvents(summary, now);
    return { summary, events };
  }

  isTodayNotable(summary, now) {
    return this.isToday(summary, now) &&
      this.isNotable(summary, this.relevantTodayEvents(summary, now));
  }

  mergeBroadcasts(summary, broadcasts = []) {
    if (!this.broadcastResolver) return broadcasts ?? [];
    return this.broadcastResolver.merge(summary, broadcasts ?? []);
  }

  async resolveBroadcasts(summary, broadcasts = []) {
    if (!this.broadcastResolver) return broadcasts ?? [];
    return this.broadcastResolver.resolve(summary, broadcasts ?? []);
  }

  async broadcastEligibility(candidate) {
    try {
      if (typeof this.startgg.getTournamentBroadcasts === 'function') {
        const broadcasts = await this.startgg.getTournamentBroadcasts(candidate.summary.id);
        return {
          candidate,
          broadcasts: this.mergeBroadcasts(candidate.summary, broadcasts),
        };
      }

      // Compatibility fallback for alternate/test clients that only expose
      // getTournamentDetail().
      const detail = await this.startgg.getTournamentDetail(candidate.summary.id);
      return {
        candidate,
        broadcasts: this.mergeBroadcasts(detail.summary, detail.broadcasts ?? []),
      };
    } catch (error) {
      this.logger.warn(
        `Could not verify start.gg broadcasts for ${candidate.summary.id}: ${error?.message ?? error}`,
      );
      // An explicit official override is independent evidence of a broadcast
      // and should still work if start.gg's stream query itself fails.
      return {
        candidate,
        broadcasts: this.mergeBroadcasts(candidate.summary, []),
      };
    }
  }

  async discover(now) {
    const [weekStart, weekEnd] = this.weekBounds(now);
    const discovered = await this.startgg.discoverWeek(
      Math.floor(weekStart.getTime() / 1000),
      Math.floor(weekEnd.getTime() / 1000),
    );
    const summaries = await this.hydrateSuspiciousSchedules(discovered, weekStart, weekEnd);

    const weeklyCandidates = summaries
      .filter((summary) => GuideService.overlaps(summary, weekStart, weekEnd))
      .filter((summary) => !this.isConcluded(summary, now))
      .map((summary) => this.weeklyCandidate(summary, weekStart, weekEnd, now))
      .filter((candidate) => this.isNotable(candidate.summary, candidate.events));

    const todayCandidates = weeklyCandidates
      .filter((candidate) => this.isToday(candidate.summary, now))
      .map((candidate) => this.todayCandidate(candidate.summary, now))
      .filter((candidate) => this.isNotable(candidate.summary, candidate.events))
      .sort((a, b) => this.compareRank(a, b));

    const allTodayIds = new Set(todayCandidates.map((candidate) => candidate.summary.id));
    const otherCandidates = weeklyCandidates
      .filter((candidate) => !allTodayIds.has(candidate.summary.id))
      .sort((a, b) => this.compareRank(a, b));

    // Stream availability is an eligibility requirement, not merely display
    // metadata. Verify every notable candidate before applying slot limits so
    // a streamless higher-ranked tournament cannot block a streamed fallback.
    const rankedCandidates = [...todayCandidates, ...otherCandidates];
    const eligibility = await Promise.all(
      rankedCandidates.map((candidate) => this.broadcastEligibility(candidate)),
    );
    const broadcastsById = new Map(
      eligibility
        .filter(({ broadcasts }) => broadcasts.length > 0)
        .map(({ candidate, broadcasts }) => [candidate.summary.id, broadcasts]),
    );

    const eligibleToday = todayCandidates
      .filter((candidate) => broadcastsById.has(candidate.summary.id))
      .slice(0, this.config.maxTodayTournaments);

    const eligibleTodayIds = new Set(eligibleToday.map((candidate) => candidate.summary.id));
    const eligibleOther = otherCandidates
      .filter((candidate) => !eligibleTodayIds.has(candidate.summary.id))
      .filter((candidate) => broadcastsById.has(candidate.summary.id));

    const remainingSlots = Math.max(0, this.config.maxWeeklyTournaments - eligibleToday.length);
    const selectedCandidates = [
      ...eligibleToday,
      ...eligibleOther.slice(0, remainingSlots),
    ];

    if (!selectedCandidates.length) {
      this.selected = [];
      this.lastDiscoveryAt = now;
      return;
    }

    const results = await Promise.allSettled(
      selectedCandidates.map((candidate) => this.startgg.getTournamentDetail(candidate.summary.id)),
    );

    const hydratedDetails = await Promise.all(
      selectedCandidates.map(async (candidate, index) => {
        const result = results[index];
        if (result.status === 'fulfilled') {
          const detail = result.value;
          const relevantEvents = this.relevantWeekEvents(detail.summary, weekStart, weekEnd, now);

          // Re-check against the fully hydrated detail. A reused series page
          // can change between discovery and detail fetch; historical brackets
          // must never rescue a tiny current/upcoming bracket.
          if (!this.isNotable(detail.summary, relevantEvents)) return null;

          const broadcasts = await this.resolveBroadcasts(detail.summary, detail.broadcasts);
          return new TournamentDetail(detail.summary, broadcasts, relevantEvents);
        }

        this.logger.warn(
          `Could not load tournament detail for ${candidate.summary.id}: ${result.reason?.message ?? result.reason}`,
        );
        // Eligibility may have been satisfied by start.gg or by an explicit
        // official override. Preserve that verified association if the richer
        // queue/detail request fails.
        return new TournamentDetail(
          candidate.summary,
          broadcastsById.get(candidate.summary.id) ?? [],
          candidate.events,
        );
      }),
    );

    this.selected = hydratedDetails
      .filter(Boolean)
      .filter((item) => item.broadcasts.length > 0)
      .filter((item) => !this.isConcluded(item.summary, now));

    this.lastDiscoveryAt = now;
  }

  async refreshTodayDetails(now) {
    const targets = this.selected.filter((item) => this.isTodayNotable(item.summary, now));
    if (!targets.length) return;

    const results = await Promise.allSettled(
      targets.map((item) => this.startgg.getTournamentDetail(item.summary.id)),
    );
    const [weekStart, weekEnd] = this.weekBounds(now);
    const replacements = new Map();
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const old = targets[index];
      if (result.status === 'fulfilled') {
        const detail = result.value;
        const relevantEvents = this.relevantWeekEvents(detail.summary, weekStart, weekEnd, now);
        if (!this.isNotable(detail.summary, relevantEvents)) {
          replacements.set(old.summary.id, null);
          continue;
        }
        const broadcasts = await this.resolveBroadcasts(detail.summary, detail.broadcasts);
        replacements.set(
          old.summary.id,
          new TournamentDetail(detail.summary, broadcasts, relevantEvents),
        );
      } else {
        this.logger.warn(
          `Could not refresh live detail for ${old.summary.id}: ${result.reason?.message ?? result.reason}`,
        );
      }
    }
    this.selected = this.selected
      .map((item) => (replacements.has(item.summary.id) ? replacements.get(item.summary.id) : item))
      .filter(Boolean)
      .filter((item) => item.broadcasts.length > 0)
      .filter((item) => !this.isConcluded(item.summary, now));
  }

  async snapshot(now = new Date()) {
    const [weekStart, weekEnd] = this.weekBounds(now);
    const discoveryDue =
      this.lastDiscoveryAt == null ||
      now.getTime() - this.lastDiscoveryAt.getTime() >= this.config.discoveryRefreshSeconds * 1000;

    try {
      if (discoveryDue) await this.discover(now);
      else await this.refreshTodayDetails(now);

      const weekly = this.selected
        .filter((item) => item.broadcasts.length > 0)
        .filter((item) => !this.isConcluded(item.summary, now))
        .map((item) => {
          const relevantEvents = this.relevantWeekEvents(item.summary, weekStart, weekEnd, now);
          if (!this.isNotable(item.summary, relevantEvents)) return null;
          return new TournamentDetail(item.summary, item.broadcasts, relevantEvents);
        })
        .filter(Boolean)
        .sort(
          (a, b) => a.summary.startAt - b.summary.startAt || b.summary.numAttendees - a.summary.numAttendees,
        );

      const today = weekly
        .filter((item) => this.isToday(item.summary, now))
        .map((item) => {
          const relevantEvents = this.relevantTodayEvents(item.summary, now);
          if (!this.isNotable(item.summary, relevantEvents)) return null;
          return new TournamentDetail(item.summary, item.broadcasts, relevantEvents);
        })
        .filter(Boolean);
      const snapshot = new GuideSnapshot({ generatedAt: now, weekStart, weekEnd, weekly, today });
      this.lastGoodSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      if (!(error instanceof StartGGError)) throw error;
      this.logger.error('start.gg refresh failed', error);
      if (!this.lastGoodSnapshot) throw error;

      const weekly = this.lastGoodSnapshot.weekly
        .filter((item) => item.broadcasts.length > 0)
        .filter((item) => !this.isConcluded(item.summary, now))
        .map((item) => {
          const relevantEvents = this.relevantWeekEvents(item.summary, weekStart, weekEnd, now);
          if (!this.isNotable(item.summary, relevantEvents)) return null;
          return new TournamentDetail(item.summary, item.broadcasts, relevantEvents);
        })
        .filter(Boolean);
      const today = weekly
        .filter((item) => this.isToday(item.summary, now))
        .map((item) => {
          const relevantEvents = this.relevantTodayEvents(item.summary, now);
          if (!this.isNotable(item.summary, relevantEvents)) return null;
          return new TournamentDetail(item.summary, item.broadcasts, relevantEvents);
        })
        .filter(Boolean);
      return new GuideSnapshot({
        generatedAt: now,
        weekStart,
        weekEnd,
        weekly,
        today,
        errorNote: 'start.gg refresh failed; showing the most recent successful data.',
      });
    }
  }
}
