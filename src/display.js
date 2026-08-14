import {
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { addLocalDays, zonedParts } from './time.js';

export const DISPLAY_TITLE = '📺 Stream Guide';

// Discord allows up to 40 components total in a Components V2 message.
// This layout uses one Container + one Text Display per tournament, plus
// five fixed top-level components. 17 tournaments therefore stays at 39.
const MAX_TOURNAMENT_CONTAINERS = 17;

function games(summary, relevantEvents = summary.events ?? []) {
  const names = [...new Set((relevantEvents ?? []).map((event) => event.shortGame).filter(Boolean))];
  return names.length ? names.join(' + ') : 'Smash';
}

function location(summary) {
  return [summary.city, summary.addrState || summary.countryCode]
    .filter(Boolean)
    .join(', ') || 'Online / location not listed';
}

function entrantLabel(summary, relevantEvents) {
  const maxEntrants = (relevantEvents ?? []).reduce(
    (max, event) => Math.max(max, Number(event.numEntrants) || 0),
    0,
  );

  if (maxEntrants > 0) {
    return `${maxEntrants.toLocaleString('en-US')} entrants`;
  }

  // Compact tournaments may qualify through tournament attendance only when
  // start.gg provides no event entrant data at all. Keep that fallback visible
  // rather than pretending an entrant count exists.
  if (summary.numAttendees > 0) {
    return `${summary.numAttendees.toLocaleString('en-US')} attendees`;
  }

  return 'Entrant count not listed';
}

function displayStartAt(detail) {
  const starts = (detail.relevantEvents ?? [])
    .map((event) => Number(event.startAt))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);

  return starts.length ? Math.min(...starts) : detail.summary.startAt;
}

function tournamentUrl(summary) {
  return `[Tournament page](${summary.url})`;
}

function monthName(month) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2020, month - 1, 1)));
}

function weekLabel(snapshot, timeZone) {
  const lastDay = addLocalDays(snapshot.weekEnd, -1, timeZone);
  const start = zonedParts(snapshot.weekStart, timeZone);
  const end = zonedParts(lastDay, timeZone);

  if (start.month === end.month) {
    return `${monthName(start.month)} ${start.day}–${end.day}`;
  }

  return `${monthName(start.month)} ${start.day}–${monthName(end.month)} ${end.day}`;
}

function refreshedLabel(date, timeZone) {
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);

  const commonZones = {
    'America/New_York': 'ET',
    'America/Chicago': 'CT',
    'America/Denver': 'MT',
    'America/Los_Angeles': 'PT',
  };

  if (commonZones[timeZone]) return `${time} ${commonZones[timeZone]}`;

  const zoneName = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;

  return zoneName ? `${time} ${zoneName}` : time;
}


function validTimeZone(candidate, fallback) {
  if (!candidate) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
}

function weeklyDateLabel(timestamp, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(new Date(timestamp * 1000));
}

function setContext(queueSet) {
  return [queueSet.shortGame, queueSet.fullRoundText].filter(Boolean).join(' · ');
}

function streamLink(broadcast) {
  const name = broadcast.streamName || 'Unnamed stream';
  return broadcast.url ? `[${name}](${broadcast.url})` : name;
}

function broadcastLines(broadcast) {
  const isInfoLink =
    broadcast.isOnline == null &&
    String(broadcast.streamSource ?? '').toUpperCase() === 'WEB';
  const status =
    broadcast.isOnline === true
      ? '🔴 **LIVE**'
      : broadcast.isOnline === false
        ? '⚫ **Offline**'
        : isInfoLink
          ? '📺 **Broadcast info**'
          : '⚪ Live status unavailable';

  const lines = [`${status} — ${streamLink(broadcast)}`];
  const [current, nextSet] = broadcast.currentAndNext();

  if (current) {
    const context = setContext(current);
    if (context) lines.push(context);
    if (current.matchup) lines.push(`**${current.matchup}**`);
  } else {
    const reliableGame = nextSet?.shortGame || broadcast.streamGame;
    if (reliableGame) lines.push(reliableGame);
  }

  if (nextSet) {
    if (nextSet.matchup) {
      lines.push(`Up next: **${nextSet.matchup}**`);
    } else {
      const nextContext = setContext(nextSet);
      if (nextContext) lines.push(`Up next: ${nextContext}`);
    }
  }

  return lines;
}

function todayTournamentText(detail, timeZone) {
  const { summary, relevantEvents } = detail;
  const lines = [
    `### ${summary.name}`,
    `🎮 ${games(summary, relevantEvents)}`,
    `📅 ${weeklyDateLabel(displayStartAt(detail), validTimeZone(summary.timezone, timeZone))}`,
    `📍 ${location(summary)}`,
    `👥 ${entrantLabel(summary, relevantEvents)}`,
    `🔗 ${tournamentUrl(summary)}`,
    '',
    '**Broadcasts**',
  ];

  if (detail.broadcasts.length) {
    for (const broadcast of detail.broadcasts) {
      lines.push(...broadcastLines(broadcast));
    }
  } else {
    lines.push('📺 No broadcast is currently listed by start.gg.');
  }

  return lines.join('\n');
}

function weeklyTournamentText(detail, timeZone) {
  const { summary, relevantEvents } = detail;
  return [
    `### ${summary.name}`,
    `🎮 ${games(summary, relevantEvents)}`,
    `📅 ${weeklyDateLabel(displayStartAt(detail), validTimeZone(summary.timezone, timeZone))}`,
    `📍 ${location(summary)}`,
    `👥 ${entrantLabel(summary, relevantEvents)}`,
    `🔗 ${tournamentUrl(summary)}`,
  ].join('\n');
}

function textDisplay(content) {
  return new TextDisplayBuilder().setContent(content);
}

function tournamentContainer(content) {
  return new ContainerBuilder().addTextDisplayComponents(textDisplay(content));
}

function spacingSeparator(spacing = SeparatorSpacingSize.Small) {
  return new SeparatorBuilder()
    .setDivider(false)
    .setSpacing(spacing);
}

export function buildComponents(snapshot, timeZone) {
  const todayIds = new Set(snapshot.today.map((item) => item.summary.id));
  const alsoThisWeek = snapshot.weekly.filter((item) => !todayIds.has(item.summary.id));

  // Keep the whole message within Discord's 40-component limit even if the
  // environment raises MAX_WEEKLY_TOURNAMENTS above the project's default.
  const today = snapshot.today.slice(0, MAX_TOURNAMENT_CONTAINERS);
  const remainingSlots = Math.max(0, MAX_TOURNAMENT_CONTAINERS - today.length);
  const weekly = alsoThisWeek.slice(0, remainingSlots);

  const components = [
    textDisplay(
      `# ${DISPLAY_TITLE}\n**Week of ${weekLabel(snapshot, timeZone)}**\n-# Last refreshed: ${refreshedLabel(snapshot.generatedAt, timeZone)}`,
    ),
    spacingSeparator(),
    textDisplay('## 🔥 Happening Today'),
  ];

  if (today.length) {
    for (const detail of today) {
      components.push(tournamentContainer(todayTournamentText(detail, timeZone)));
    }
  } else {
    components.push(
      tournamentContainer('Nothing notable on the guide is scheduled for today.'),
    );
  }

  components.push(
    spacingSeparator(SeparatorSpacingSize.Large),
    textDisplay('## 📅 Also This Week'),
  );

  if (weekly.length) {
    for (const detail of weekly) {
      components.push(tournamentContainer(weeklyTournamentText(detail, timeZone)));
    }
  } else {
    const emptyMessage = snapshot.weekly.length
      ? 'No other notable tournaments are currently listed for this week.'
      : 'No tournaments currently meet the guide’s notability thresholds.';
    components.push(tournamentContainer(emptyMessage));
  }

  return components;
}
