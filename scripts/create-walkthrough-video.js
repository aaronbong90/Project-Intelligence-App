const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "docs", "video-assets", "walkthrough");
const screensDir = path.join(outputDir, "screens");
const slidesDir = path.join(outputDir, "slides");
const audioDir = path.join(outputDir, "audio");
const segmentsDir = path.join(outputDir, "segments");
const outputVideo = path.join(root, "docs", "project-field-hub-pro-walkthrough.mp4");
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const appUrl = process.env.APP_URL || "http://localhost:3001/dashboard";
const endPauseSeconds = Number(process.env.SCENE_END_PAUSE_SECONDS || "0.65");
const syncToleranceSeconds = Number(process.env.SYNC_TOLERANCE_SECONDS || "0.1");

const scenes = [
  {
    id: "01-opening",
    title: "Project Field Hub Pro",
    caption: "A shared project dashboard for submissions, reports, finance, defects, and close-out.",
    narration:
      "Welcome to Project Field Hub Pro. This dashboard keeps project records, submissions, reports, financial items, defects, and close-out tracking in one shared workspace.",
    capture: async (page) => {
      await page.goto(appUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
    }
  },
  {
    id: "02-theme",
    title: "Light And Dark Mode",
    caption: "Use the top navigation to switch themes. The app remembers your preference.",
    narration:
      "You can switch between light mode and dark mode from the top navigation. The app remembers your choice for the next time you open the dashboard.",
    capture: async (page) => {
      await page.getByRole("button", { name: /dark mode/i }).click().catch(() => {});
      await page.waitForTimeout(700);
    }
  },
  {
    id: "03-projects",
    title: "Create Or Select A Project",
    caption: "Create a project, then switch between accessible projects from the project chips.",
    narration:
      "At the top of the dashboard, you can create a new project or switch between projects you have access to. Each project has its own records and notification history.",
    capture: async (page) => {
      await page.getByRole("button", { name: /light mode/i }).click().catch(() => {});
      await page.locator(".content-card", { hasText: "Create and switch projects" }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }
  },
  {
    id: "04-notifications",
    title: "Recent Project Changes",
    caption: "Notifications show who changed what, which section changed, and when it happened.",
    narration:
      "The notification panel shows recent changes made inside the active project. When a team member creates, updates, deletes, approves, rejects, or imports records, the update is logged here.",
    capture: async (page) => {
      await page.locator(".notification-panel").scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }
  },
  {
    id: "05-modules",
    title: "Navigate Project Modules",
    caption: "Use the project menu to open Overview, Submissions, Reports, Financials, Completion, and Defects.",
    narration:
      "The project menu lets you move between modules. Access is role-based, so each user only sees the modules they are allowed to use.",
    capture: async (page) => {
      await page.locator(".dashboard-sidebar").scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }
  },
  {
    id: "06-overview",
    title: "Update The Project Overview",
    caption: "Edit the project name, client, contractor, handover date, completion date, and project details.",
    narration:
      "The Overview module stores the core project information. Updating these details refreshes the dashboard summary and creates a notification for users on the same project.",
    capture: async (page) => {
      await page.getByRole("button", { name: /^Overview$/i }).click().catch(() => {});
      await page.locator("summary", { hasText: "Project details" }).click().catch(() => {});
      await page.waitForTimeout(700);
    }
  },
  {
    id: "07-team",
    title: "Manage Contractor And Consultant Details",
    caption: "List contractor companies, consultant companies, roles, and responsible trades.",
    narration:
      "The team setup areas keep contractor and consultant information organized. Main contractors, subcontractors, architects, and MEP consultants can be listed with their responsible trades.",
    capture: async (page) => {
      await page.locator("summary", { hasText: "Contractor information" }).click().catch(() => {});
      await page.locator("summary", { hasText: "Contractor information" }).scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(700);
    }
  },
  {
    id: "08-submissions",
    title: "Submit And Review Documents",
    caption: "Handle contractor submissions, RFIs, method statements, project programmes, and consultant documents.",
    narration:
      "The submission module handles contractor submissions, RFIs, method statements, project programmes, and consultant documents. Users can create, review, accept, return, or reset records based on their role.",
    capture: async (page) => {
      await page.getByRole("button", { name: /documents submission/i }).click().catch(() => {});
      await page.waitForTimeout(700);
    }
  },
  {
    id: "09-reports",
    title: "Add Daily And Weekly Reports",
    caption: "Capture site progress, locations, manpower notes, summaries, and attachments.",
    narration:
      "Daily and weekly reports capture site progress. You can add descriptions, manpower notes, progress summaries, and supporting attachments so the project history stays complete.",
    capture: async (page) => {
      await page.getByRole("button", { name: /daily reports/i }).click().catch(() => {});
      await page.waitForTimeout(700);
    }
  },
  {
    id: "10-financials",
    title: "Track Financials",
    caption: "Track quotations, invoices, variation orders, submissions, approvals, rejections, and paid status.",
    narration:
      "The Financials module tracks quotations, invoices, and variation orders. Submitters can prepare and submit records for review, while authorized users can approve, reject, or mark items as paid.",
    capture: async (page) => {
      await page.getByRole("button", { name: /financials/i }).click().catch(() => {});
      await page.waitForTimeout(700);
    }
  },
  {
    id: "11-defects",
    title: "Manage Completion And Defects",
    caption: "Create checklist items, defect zones, defect records with photos, and Excel defect imports.",
    narration:
      "Completion and Defects help manage close-out. You can create checklist items, add defect records with photos, organize defects by zone, and import defect registers from Excel.",
    capture: async (page) => {
      await page.getByRole("button", { name: /defects/i }).click().catch(() => {});
      await page.waitForTimeout(700);
    }
  },
  {
    id: "12-access",
    title: "Access Control",
    caption: "Admins assign project users, roles, and module permissions so each party sees the right workflow.",
    narration:
      "Admins can assign users to a project and control which modules they can access. This keeps each party focused on the records they are responsible for.",
    capture: async (page) => {
      await page.locator(".dashboard-sidebar").scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }
  },
  {
    id: "13-closing",
    title: "Keep The Project Team Aligned",
    caption: "Create records, track updates, review changes, and use notifications to keep everyone informed.",
    narration:
      "That is the core workflow. Create a project, invite the right users, update records through each module, and use notifications to keep the team aligned as the project changes.",
    capture: async (page) => {
      await page.goto(appUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
    }
  }
];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function runForOutput(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function parseDurationSeconds(output) {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    throw new Error("Unable to read media duration from ffmpeg output.");
  }

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function getMediaDuration(filePath) {
  const result = await runForOutput(ffmpegPath, ["-hide_banner", "-i", filePath]);
  return parseDurationSeconds(result.stderr);
}

function roundDuration(value) {
  return Math.ceil(value * 100) / 100;
}

function readExtended80(buffer, offset) {
  const exponentWord = buffer.readUInt16BE(offset);
  const exponent = exponentWord & 0x7fff;
  const sign = exponentWord & 0x8000 ? -1 : 1;
  const mantissa = Number(buffer.readBigUInt64BE(offset + 2));

  if (exponent === 0 && mantissa === 0) {
    return 0;
  }

  return sign * mantissa * 2 ** (exponent - 16383 - 63);
}

async function getAiffDuration(filePath) {
  const buffer = await fs.readFile(filePath);

  if (buffer.toString("ascii", 0, 4) !== "FORM") {
    throw new Error(`${filePath} is not an AIFF/AIFC file.`);
  }

  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32BE(offset + 4);
    const chunkData = offset + 8;

    if (chunkType === "COMM") {
      const sampleFrames = buffer.readUInt32BE(chunkData + 2);
      const sampleRate = readExtended80(buffer, chunkData + 8);
      return sampleFrames / sampleRate;
    }

    offset = chunkData + chunkSize + (chunkSize % 2);
  }

  throw new Error(`Unable to find COMM chunk in ${filePath}.`);
}

function readMp4Boxes(buffer, start, end) {
  const boxes = [];

  for (let offset = start; offset + 8 <= end;) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) {
      break;
    }

    boxes.push({ type, start: offset, headerSize, end: offset + size });
    offset += size;
  }

  return boxes;
}

function findMp4Boxes(buffer, parent, pathParts) {
  let current = [parent];

  for (const part of pathParts) {
    current = current.flatMap((box) =>
      readMp4Boxes(buffer, box.start + box.headerSize, box.end).filter((child) => child.type === part)
    );
  }

  return current;
}

function readMdhdDuration(buffer, mdhd) {
  const offset = mdhd.start + mdhd.headerSize;
  const version = buffer.readUInt8(offset);
  const timescaleOffset = offset + (version === 1 ? 20 : 12);
  const durationOffset = offset + (version === 1 ? 24 : 16);
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const duration = version === 1 ? Number(buffer.readBigUInt64BE(durationOffset)) : buffer.readUInt32BE(durationOffset);

  return duration / timescale;
}

async function getMp4TrackDurations(filePath) {
  const buffer = await fs.readFile(filePath);
  const root = { start: 0, headerSize: 0, end: buffer.length };
  const tracks = findMp4Boxes(buffer, root, ["moov", "trak"]);
  const durations = {};

  for (const track of tracks) {
    const mdia = readMp4Boxes(buffer, track.start + track.headerSize, track.end).find((box) => box.type === "mdia");

    if (!mdia) {
      continue;
    }

    const mdiaChildren = readMp4Boxes(buffer, mdia.start + mdia.headerSize, mdia.end);
    const hdlr = mdiaChildren.find((box) => box.type === "hdlr");
    const mdhd = mdiaChildren.find((box) => box.type === "mdhd");

    if (!hdlr || !mdhd) {
      continue;
    }

    const handler = buffer.toString("ascii", hdlr.start + hdlr.headerSize + 8, hdlr.start + hdlr.headerSize + 12);
    durations[handler] = readMdhdDuration(buffer, mdhd);
  }

  return {
    video: durations.vide,
    audio: durations.soun
  };
}

function assertInSync(label, videoDuration, audioDuration) {
  const drift = videoDuration - audioDuration;

  if (Math.abs(drift) > syncToleranceSeconds) {
    throw new Error(
      `${label} audio/video drift is ${drift.toFixed(3)}s ` +
        `(video ${videoDuration.toFixed(3)}s, audio ${audioDuration.toFixed(3)}s).`
    );
  }

  return drift;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function renderSlide(browser, scene, screenPath, slidePath) {
  const image = await fs.readFile(screenPath, "base64");
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            width: 1920px;
            height: 1080px;
            background: #0f172a;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: white;
            overflow: hidden;
          }
          .frame {
            position: absolute;
            inset: 44px 64px 166px;
            border-radius: 18px;
            overflow: hidden;
            background: #111827;
            box-shadow: 0 32px 80px rgba(0, 0, 0, 0.42);
          }
          img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
          }
          .caption {
            position: absolute;
            left: 64px;
            right: 64px;
            bottom: 44px;
            min-height: 98px;
            display: grid;
            grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.5fr);
            gap: 36px;
            align-items: center;
            padding: 24px 30px;
            border: 1px solid rgba(148, 163, 184, 0.32);
            border-radius: 16px;
            background: rgba(15, 23, 42, 0.92);
          }
          h1 {
            margin: 0;
            font-size: 35px;
            line-height: 1.12;
            letter-spacing: 0;
          }
          p {
            margin: 0;
            color: #cbd5e1;
            font-size: 24px;
            line-height: 1.38;
          }
          .brand {
            position: absolute;
            top: 54px;
            left: 78px;
            z-index: 2;
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(15, 23, 42, 0.78);
            color: #e0f2fe;
            font-size: 18px;
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <div class="brand">Project Field Hub Pro</div>
        <div class="frame"><img src="data:image/png;base64,${image}" alt=""></div>
        <div class="caption">
          <h1>${escapeHtml(scene.title)}</h1>
          <p>${escapeHtml(scene.caption)}</p>
        </div>
      </body>
    </html>
  `);

  await page.screenshot({ path: slidePath });
  await page.close();
}

async function main() {
  await fs.mkdir(screensDir, { recursive: true });
  await fs.mkdir(slidesDir, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });
  await fs.mkdir(segmentsDir, { recursive: true });

  const browser = await chromium.launch();
  const capturePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  for (const scene of scenes) {
    const screenPath = path.join(screensDir, `${scene.id}.png`);
    const slidePath = path.join(slidesDir, `${scene.id}.png`);
    const audioPath = path.join(audioDir, `${scene.id}.aiff`);
    const segmentPath = path.join(segmentsDir, `${scene.id}.mp4`);

    console.log(`Capturing ${scene.id}`);
    await scene.capture(capturePage);
    await capturePage.screenshot({ path: screenPath, fullPage: false });
    await renderSlide(browser, scene, screenPath, slidePath);

    console.log(`Narrating ${scene.id}`);
    await run("/usr/bin/say", ["-v", "Samantha", "-o", audioPath, scene.narration]);
    const audioDuration = await getAiffDuration(audioPath);
    const segmentDuration = roundDuration(audioDuration + endPauseSeconds);

    console.log(`Rendering ${scene.id} (${segmentDuration.toFixed(2)}s for ${audioDuration.toFixed(2)}s narration)`);
    await run(ffmpegPath, [
      "-y",
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      String(segmentDuration),
      "-i",
      slidePath,
      "-i",
      audioPath,
      "-filter_complex",
      `[0:v]scale=1920:1080,format=yuv420p[v];[1:a]aresample=48000,apad=pad_dur=${endPauseSeconds}[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-tune",
      "stillimage",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-t",
      String(segmentDuration),
      "-movflags",
      "+faststart",
      segmentPath
    ]);

    scene.audioDuration = audioDuration;
    const trackDurations = await getMp4TrackDurations(segmentPath);
    scene.videoDuration = trackDurations.video;
    scene.segmentAudioDuration = trackDurations.audio;
    scene.driftSeconds = assertInSync(scene.id, trackDurations.video, trackDurations.audio);
  }

  await capturePage.close();
  await browser.close();

  const concatPath = path.join(outputDir, "segments.txt");
  await fs.writeFile(concatPath, scenes.map((scene) => `file '${path.join(segmentsDir, `${scene.id}.mp4`).replaceAll("'", "'\\''")}'`).join("\n"));

  console.log("Combining final video");
  await run(ffmpegPath, [
    "-y",
    "-fflags",
    "+genpts",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c:v",
    "libx264",
    "-r",
    "30",
    "-af",
    "aresample=async=1:first_pts=0",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputVideo
  ]);

  const finalDuration = await getMediaDuration(outputVideo);
  const finalTrackDurations = await getMp4TrackDurations(outputVideo);
  const finalDrift = assertInSync("Final video", finalTrackDurations.video, finalTrackDurations.audio);
  const expectedDuration = scenes.reduce((total, scene) => total + (scene.videoDuration || 0), 0);
  const report = {
    outputVideo,
    appUrl,
    endPauseSeconds,
    syncToleranceSeconds,
    expectedDuration,
    finalDuration,
    driftSeconds: finalDuration - expectedDuration,
    finalTrackDurations,
    finalAudioVideoDriftSeconds: finalDrift,
    scenes: scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      audioDuration: scene.audioDuration,
      videoDuration: scene.videoDuration,
      segmentAudioDuration: scene.segmentAudioDuration,
      audioVideoDriftSeconds: scene.driftSeconds,
      expectedPause: scene.videoDuration && scene.audioDuration ? scene.videoDuration - scene.audioDuration : null
    }))
  };
  await fs.writeFile(path.join(outputDir, "sync-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Created ${outputVideo}`);
  console.log(`Final duration drift: ${report.driftSeconds.toFixed(3)} seconds`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
