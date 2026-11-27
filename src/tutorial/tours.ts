import { useBoards } from '../boardStore';
import { useStore, type MobileView, type PanelTab } from '../store';

/** Scratch space a step can use, e.g. to remember how things looked when it started. */
export type StepContext = Record<string, unknown>;

export interface TourStep {
  /** `data-tour` name of the element to highlight; none = a card in the middle of the screen. */
  target?: string;
  /** Highlight this instead when the target isn't on screen (e.g. hidden on a phone). */
  fallback?: string;
  title: string;
  /** Plain text; a blank line starts a new paragraph. */
  body: string;
  /** On a phone, which pane to show for this step. */
  mobile?: MobileView;
  /** Get the screen ready for the step (mode, tab, step...). Runs each time the step opens. */
  before?: (ctx: StepContext) => void;
  /** A hands-on step: the tour waits (the user can still skip) until `done` is true. */
  task?: { hint: string; done: (ctx: StepContext) => boolean };
}

export interface Tour {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  steps: TourStep[];
}

const app = () => useStore.getState();
const boards = () => useBoards.getState();

/** Leave full-screen views and stop playback so nothing covers what the tour points at. */
function calm() {
  app().setPlaying(false);
  app().setPresenting(false);
  boards().setPresenting(false);
}

function tactics(tab?: PanelTab, view3d = false) {
  calm();
  boards().setMode('tactics');
  if (!!app().settings.view3d !== view3d) app().setSettings({ view3d });
  if (tab) app().setTab(tab);
}

function board() {
  calm();
  boards().setMode('board');
  boards().setTool('select');
}

const currentStep = () => app().current.steps[app().stepIndex];

export const TOURS: Tour[] = [
  {
    id: 'overview',
    title: 'Quick tour',
    summary: 'A walk round the whole app: tactics, steps, playback, analysis, the assistant coach and the tactics board.',
    minutes: 2,
    steps: [
      {
        title: 'Welcome to Tactical Manager',
        body: 'Design tactics for any game from 4v4 to 11v11, animate them step by step, and let the analysis judge whether they would work against a realistic opponent. There is also a free tactics board for team talks.\n\nUse Next and Back (or the arrow keys) to move through the tour.',
        before: () => tactics('edit'),
      },
      {
        target: 'mode-switch',
        title: 'Two ways to work',
        body: 'Tactics is the animated planner: build a move step by step and play it back.\n\nBoard is a free tactics board, like a magnetic one in the dressing room: drag players and draw, with no steps.',
        before: () => tactics(),
      },
      {
        target: 'library',
        mobile: 'library',
        title: 'Your tactics',
        body: 'My tactics keeps everything you make; it saves as you go. Library has ready-made tactics for every format. Open one to see how it is built; if you edit it, it becomes your own copy.\n\nExport and Import share tactics as files.',
        before: () => tactics(),
      },
      {
        target: 'new-tactic',
        mobile: 'library',
        title: 'Start a new tactic',
        body: 'Choose the format (4v4 to 11v11), both formations and the kind of move: attack, defence, transition or set piece.',
        before: () => tactics(),
      },
      {
        target: 'pitch',
        mobile: 'board',
        title: 'The pitch',
        body: 'Drag players to place them. In Setup you set where everyone starts; in a step you set where they are at the end of it. Drag the ball onto a player to give them the ball.',
        before: () => tactics(),
      },
      {
        target: 'tools',
        mobile: 'board',
        title: 'Draw the movement',
        body: 'Run draws a player\'s run. Pass and Cross play the ball to a team-mate or into space. Dribble carries it, Shoot aims at goal and Clear gets it away.\n\nKeys: V R P C D S L. Prev step shows the step before as a faint shadow while you edit.',
        before: () => tactics(),
      },
      {
        target: 'steps',
        mobile: 'board',
        title: 'Steps',
        body: 'A move is a sequence of steps, like the phases you would explain on a whiteboard. Each step has a length in seconds; + Step adds the next one.\n\nThe players without a run of their own can be moved for you by the assistant coach, so both teams behave like real teams.',
        before: () => tactics(),
      },
      {
        target: 'playback',
        mobile: 'board',
        title: 'Play it back',
        body: 'Play the move with realistic running and ball speeds, scrub through it, slow it down or loop it. Present opens a full-screen view with your coaching notes, for showing the players.',
        before: () => tactics(),
      },
      {
        target: 'view-toggle',
        mobile: 'board',
        title: 'Watch it in 3D',
        body: 'Switch to 3D to see the move as a match: players run, turn and accelerate like real footballers, the ball flies for crosses, and you choose the camera (TV, tactical, behind the goal, following the ball) or drag to look around.\n\nEditing stays in 2D; Present works in both.',
        before: () => tactics(undefined, true),
      },
      {
        target: 'tab-edit',
        mobile: 'panel',
        title: 'Details of each step',
        body: 'Write the coaching note, say what the step should achieve (keep the ball, create a chance, win it back...), and change its length, the ball action or the formations.',
        before: () => tactics('edit'),
      },
      {
        target: 'tab-analysis',
        mobile: 'panel',
        title: 'Analysis',
        body: 'The analysis replays every step and checks running speeds, passing lanes against moving defenders, offside, pressure, shot quality and team shape. Click a finding to jump to that moment; many have a one-click fix.',
        before: () => tactics('analysis'),
      },
      {
        target: 'score',
        fallback: 'tab-analysis',
        mobile: 'panel',
        title: 'The score',
        body: 'The overall score and grade of the open tactic, updated as you edit. On a phone it is at the top of the Analysis tab.',
        before: () => tactics('analysis'),
      },
      {
        target: 'tab-coach',
        mobile: 'panel',
        title: 'Assistant coach',
        body: 'Generate an attacking move or a press, make the opponents react like a well-drilled team, move your own team with the play, and get formation advice. You can also connect the optional AI coach in Settings.',
        before: () => tactics('coach'),
      },
      {
        target: 'open-on-board',
        mobile: 'board',
        title: 'Freeze a moment',
        body: 'Open on board copies what is on the pitch, with its runs and passes, onto the free tactics board so you can mark it up for a team talk.',
        before: () => tactics('edit'),
      },
      {
        target: 'board-pitch',
        mobile: 'board',
        title: 'The tactics board',
        body: 'Drag players, the ball, cones and goals anywhere, draw runs, passes and zones, and export a picture for your players. The board tour in the help menu shows everything it can do.',
        before: () => board(),
      },
      {
        target: 'help',
        title: 'Help is always here',
        body: 'Open this menu any time to replay a tour or check the keyboard shortcuts. Enjoy your coaching!',
        before: () => tactics('edit'),
      },
    ],
  },
  {
    id: 'first-tactic',
    title: 'Build your first tactic',
    summary: 'Hands-on: set up the players, add a step, draw a run and a pass, play it and see what the analysis says.',
    minutes: 4,
    steps: [
      {
        title: 'Let\'s build a move',
        body: 'We\'ll open a fresh 7v7 tactic called "My first tactic" for you to practise on (your other tactics stay safe in My tactics).\n\nSome steps give you a task. Do it on the pitch and the tour moves on by itself, or press Skip to move on anyway.',
        before: () => tactics('edit'),
      },
      {
        target: 'pitch',
        mobile: 'board',
        title: 'Set the starting positions',
        body: 'This is the Setup: where everyone stands before the move starts. Your team is in yellow, attacking to the right.',
        before: (ctx) => {
          tactics('edit');
          if (!ctx.created) {
            const s = app();
            if (s.current.name !== 'My first tactic' || s.current.steps.length) {
              s.newTactic({ name: 'My first tactic', format: 7, homeFormation: '2-3-1', awayFormation: '3-2-1', phase: 'attack' });
            }
            ctx.created = true;
          }
          app().setStepIndex(-1);
          app().setTool('select');
          ctx.start = JSON.stringify(app().current.initial);
        },
        task: { hint: 'Drag one of your players to a new spot.', done: (ctx) => JSON.stringify(app().current.initial) !== ctx.start },
      },
      {
        target: 'add-step',
        mobile: 'board',
        title: 'Add the first step',
        body: 'A step is one phase of the move. Its length is how long it lasts when played back.',
        before: (ctx) => {
          tactics('edit');
          ctx.steps = app().current.steps.length;
        },
        task: { hint: 'Click + Step.', done: (ctx) => app().current.steps.length > (ctx.steps as number) },
      },
      {
        target: 'tool-run',
        mobile: 'board',
        title: 'Make a run',
        body: 'Choose Run, click one of your players, then click where they should run to. Click again to bend the run; Finish run (or Esc) when you are done.',
        before: () => {
          tactics('edit');
          if (app().stepIndex < 0 && app().current.steps.length) app().setStepIndex(0);
        },
        task: {
          hint: 'Draw a run for one of your players in this step.',
          done: () => Object.keys(currentStep()?.moves ?? {}).some((id) => id.startsWith('h')),
        },
      },
      {
        target: 'tool-pass',
        mobile: 'board',
        title: 'Play a pass',
        body: 'Choose Pass, then click the team-mate who should get the ball: the player in possession passes. The ball is played to where the receiver will be when it arrives.',
        before: () => tactics('edit'),
        task: { hint: 'Add a pass in this step.', done: () => !!currentStep()?.ball && ['pass', 'cross'].includes(currentStep()!.ball!.type) },
      },
      {
        target: 'tab-edit',
        mobile: 'panel',
        title: 'Coach the step',
        body: 'The note appears during playback and in Present mode, so the players hear what you want.',
        before: () => tactics('edit'),
        task: { hint: 'Write a coaching note for this step, e.g. "Winger runs in behind, 6 finds him".', done: () => !!currentStep()?.note.trim() },
      },
      {
        target: 'play',
        mobile: 'board',
        title: 'Watch it',
        body: 'Players accelerate, carry their speed from one step to the next and pull up like real players.',
        before: () => tactics(),
        task: { hint: 'Press Play.', done: () => app().playing || app().time > 0 },
      },
      {
        target: 'tab-analysis',
        mobile: 'panel',
        title: 'Check it',
        body: 'The analysis judges your move. Problems come first: click one to see the players involved. To test it against realistic opponents, use Make opponents react in the Coach tab.',
        before: () => tactics('analysis'),
      },
      {
        title: 'You\'re ready',
        body: 'Keep adding steps to build the whole move, then share it with Present or Export. Everything is saved automatically in My tactics.',
        before: () => tactics('edit'),
      },
    ],
  },
  {
    id: 'board',
    title: 'The tactics board',
    summary: 'A free board for team talks: move players and kit, use the squad and bench, draw, and share a picture.',
    minutes: 2,
    steps: [
      {
        target: 'board-pitch',
        mobile: 'board',
        title: 'A free tactics board',
        body: 'No steps and no animation, just like a magnetic board. Drag any player or the ball. Drag a box on empty grass to select a group, such as the back four, and move it together.',
        before: () => board(),
      },
      {
        target: 'board-arrows',
        mobile: 'board',
        title: 'Runs, passes and dribbles',
        body: 'Run draws a dashed arrow, Pass a solid one and Dribble a wavy one. Start on a player and the arrow starts from them; draw a curve for a curved run.',
        before: () => board(),
      },
      {
        target: 'board-tools',
        mobile: 'board',
        title: 'More ways to draw',
        body: 'Pen draws freehand, Line draws straight lines, Zone shades an area, Text writes a note on the board, and the Eraser removes what you tap or scrub over. Pick the colour with the dots.',
        before: () => board(),
      },
      {
        target: 'board-pieces',
        mobile: 'board',
        title: 'Add players and kit',
        body: 'Add extra players, a goalkeeper, balls, cones, poles, mini goals and mannequins: tap one, then tap the board (or drag it on).',
        before: () => board(),
      },
      {
        target: 'squad',
        mobile: 'library',
        title: 'Squad and bench',
        body: 'Give your players numbers and names. Drag a player from the bench onto the board, or tap Place and then the board. Drag a player off the board to send them back to the bench.',
        before: () => board(),
      },
      {
        target: 'line-up',
        mobile: 'panel',
        title: 'Line up and pitch',
        body: 'Put either team into any formation in one click. Above it: the pitch size, full pitch or a half, and horizontal or vertical (Auto turns the board upright on a phone).',
        before: () => {
          board();
          boards().select([]);
        },
      },
      {
        target: 'board-list',
        mobile: 'library',
        title: 'As many boards as you need',
        body: 'Keep a board for each team talk, opponent or set piece. Duplicate one to try a variation.',
        before: () => board(),
      },
      {
        target: 'board-export',
        mobile: 'board',
        title: 'Share it',
        body: 'Export PNG saves a picture to send to your players. Present opens a full-screen board you can still draw on, for the dressing room.',
        before: () => board(),
      },
      {
        target: 'help',
        title: 'That\'s the board',
        body: 'You can replay any tour from the help menu.',
        before: () => board(),
      },
    ],
  },
];

export const tourById = (id: string | undefined) => TOURS.find((t) => t.id === id);
