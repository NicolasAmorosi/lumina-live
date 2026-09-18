import { useState } from "react";
import { useT, type MessageKey, type Translate } from "@renderer/lib/i18n/i18n-provider";
import {
  Button,
  Callout,
  ColorField,
  FieldGroup,
  FieldRow,
  Icon,
  Input,
  Select,
  Switch,
  type SelectOption,
} from "@renderer/components/ui";
import { useLocalFonts } from "@renderer/lib/hooks/use-local-fonts";
import { SCENE_TEXT_MAX_CQW, SCENE_TEXT_MIN_CQW, SCENE_NAME_MAX_LENGTH, SCENE_TEXT_MAX_LENGTH } from "@shared/scene-validators";
import { formatDuration, formatMinuteOfDay, parseDuration, parseMinuteOfDay } from "@shared/timer";
import {
  BACKGROUND_FITS,
  GRADIENT_DIRECTIONS,
  SCENE_FONT_WEIGHTS,
  SCENE_VERTICAL_ALIGNS,
  type SceneBackground,
  type SceneFontWeight,
  type SceneStyle,
  type SceneTextStyle,
} from "@shared/types/scene-style";
import { TIMER_MAX_DURATION_MS, TIMER_MIN_DURATION_MS, TIMER_TOOLS, type TimerTool } from "@shared/types/timer";
import type { MediaAsset } from "@shared/types/media";
import { TOOL_LABEL } from "./tool-display";
import type { SceneDraft } from "./scene-draft";

/** Only the number is ever drawn for a `clock`, and only a countdown can run
 *  out — which is what decides whether a whole group is even rendered. */
function hasCountdown(tool: TimerTool): boolean {
  return tool === "countdown" || tool === "countdown-to-time";
}

const ALIGN_LABEL: Record<(typeof SCENE_VERTICAL_ALIGNS)[number], MessageKey> = {
  top: "scenes.align.top",
  middle: "scenes.align.middle",
  bottom: "scenes.align.bottom",
};

/** Numeric weights named in words: the dictionary's keys are paths, and a
 *  numeric key is not one `MessageKey` can express. The operator reads
 *  "Negrita" either way — 700 is a CSS number, not a label. */
const WEIGHT_LABEL: Record<SceneFontWeight, MessageKey> = {
  300: "scenes.weights.light",
  400: "scenes.weights.regular",
  600: "scenes.weights.semibold",
  700: "scenes.weights.bold",
  900: "scenes.weights.black",
};

const BACKGROUND_LABEL: Record<SceneBackground["kind"], MessageKey> = {
  solid: "scenes.background.solid",
  gradient: "scenes.background.gradient",
  image: "scenes.background.image",
};

const GRADIENT_LABEL: Record<(typeof GRADIENT_DIRECTIONS)[number], MessageKey> = {
  "to-bottom": "scenes.gradient.toBottom",
  "to-right": "scenes.gradient.toRight",
  "to-bottom-right": "scenes.gradient.toBottomRight",
  radial: "scenes.gradient.radial",
};

const FIT_LABEL: Record<(typeof BACKGROUND_FITS)[number], MessageKey> = {
  cover: "scenes.fits.cover",
  contain: "scenes.fits.contain",
};

/** `null` in the row, a sentinel in the `<Select>`: a select's value is a
 *  string, and "" is already what an empty option would be. */
const APP_FONT = "__app__";

type SceneFormProps = {
  /** The image assets a background can point at, plus the button that adds
   *  more — owned by the modal, which is where the loading state lives. */
  imageAssets: readonly MediaAsset[];
  onAddImages: () => void;
  addingImages: boolean;
  onChange: (next: SceneDraft) => void;
  value: SceneDraft;
};

/**
 * Everything about one scene, as grouped rows in the same visual language as
 * Ajustes — which is what the `FieldGroup`/`FieldRow` promotion was for.
 *
 * Fully controlled: the modal owns the draft, so it is the modal that knows
 * whether there is anything unsaved. The two free-text numeric fields
 * (duration, time of day) keep a local draft of their own anyway, because a
 * half-typed `"1"` on the way to `"10:00"` must not be committed as one
 * minute and must not fight the operator's cursor.
 */
export function SceneForm({ addingImages, imageAssets, onAddImages, onChange, value }: SceneFormProps) {
  const t = useT();
  const fonts = useLocalFonts(true);

  const patch = (next: Partial<SceneDraft>) => onChange({ ...value, ...next });
  const patchStyle = (next: Partial<SceneStyle>) => patch({ style: { ...value.style, ...next } });
  const patchConfig = (next: Partial<SceneDraft["config"]>) => patch({ config: { ...value.config, ...next } });
  const patchFormat = (next: Partial<SceneDraft["config"]["format"]>) =>
    patchConfig({ format: { ...value.config.format, ...next } });

  const toolOptions: SelectOption[] = TIMER_TOOLS.map((tool) => ({
    label: t(TOOL_LABEL[tool]),
    value: tool,
  }));

  const fontOptions: SelectOption[] = [
    { label: t("scenes.fonts.app"), value: APP_FONT },
    ...(fonts.status === "ready" ? fonts.families.map((family) => ({ label: family, value: family })) : []),
    // The scene's own family, kept selectable even when this machine no longer
    // has it: dropping it silently would rewrite the row to "the app font" the
    // first time somebody saved on a different computer.
    ...(value.style.fontFamily !== null &&
    !(fonts.status === "ready" && fonts.families.includes(value.style.fontFamily))
      ? [{ label: t("scenes.fonts.missing", { name: value.style.fontFamily }), value: value.style.fontFamily }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <FieldGroup title={t("scenes.groups.scene")}>
        <FieldRow label={t("scenes.name")}>
          <Input
            className="w-64"
            maxLength={SCENE_NAME_MAX_LENGTH}
            onChange={(e) => patch({ name: e.target.value })}
            size="xs"
            value={value.name}
          />
        </FieldRow>
        <FieldRow description={t("scenes.toolHint")} label={t("scenes.tool")}>
          <Select
            className="w-52"
            onChange={(next) => patch({ tool: next as TimerTool })}
            options={toolOptions}
            size="xs"
            value={value.tool}
          />
        </FieldRow>
      </FieldGroup>

      <FieldGroup title={t("scenes.groups.time")}>
        {value.tool === "countdown" ? (
          <FieldRow description={t("scenes.durationHint")} label={t("scenes.duration")}>
            <NumericTextField
              format={formatDuration}
              onCommit={(durationMs) => patchConfig({ durationMs })}
              parse={(text) => {
                const ms = parseDuration(text);
                return ms !== null && ms >= TIMER_MIN_DURATION_MS && ms <= TIMER_MAX_DURATION_MS ? ms : null;
              }}
              value={value.config.durationMs}
            />
          </FieldRow>
        ) : null}

        {value.tool === "countdown-to-time" ? (
          <FieldRow description={t("scenes.targetTimeHint")} label={t("scenes.targetTime")}>
            <NumericTextField
              format={formatMinuteOfDay}
              onCommit={(targetMinuteOfDay) => patchConfig({ targetMinuteOfDay })}
              parse={parseMinuteOfDay}
              value={value.config.targetMinuteOfDay}
            />
          </FieldRow>
        ) : null}

        {value.tool === "clock" || value.tool === "stopwatch" ? (
          <FieldRow label={t("scenes.hour12")}>
            <Switch
              checked={value.config.format.hour12}
              onChange={(e) => patchFormat({ hour12: e.target.checked })}
            />
          </FieldRow>
        ) : null}

        {value.tool === "clock" ? (
          <FieldRow label={t("scenes.showSeconds")}>
            <Switch
              checked={value.config.format.showSeconds}
              onChange={(e) => patchFormat({ showSeconds: e.target.checked })}
            />
          </FieldRow>
        ) : null}

        <FieldRow description={t("scenes.hideZeroHoursHint")} label={t("scenes.hideZeroHours")}>
          <Switch
            checked={value.config.format.hideZeroHours}
            onChange={(e) => patchFormat({ hideZeroHours: e.target.checked })}
          />
        </FieldRow>

        {hasCountdown(value.tool) ? (
          <>
            <FieldRow description={t("scenes.overrunHint")} label={t("scenes.overrun")}>
              <Switch
                checked={value.config.format.overrun}
                onChange={(e) => patchFormat({ overrun: e.target.checked })}
              />
            </FieldRow>
            <FieldRow description={t("scenes.endMessageHint")} label={t("scenes.endMessage")}>
              <Input
                className="w-64"
                maxLength={SCENE_TEXT_MAX_LENGTH}
                onChange={(e) => patchConfig({ endMessage: e.target.value === "" ? null : e.target.value })}
                size="xs"
                value={value.config.endMessage ?? ""}
              />
            </FieldRow>
          </>
        ) : null}
      </FieldGroup>

      <FieldGroup title={t("scenes.groups.texts")}>
        <FieldRow description={t("scenes.titleHint")} label={t("scenes.titleText")}>
          <Input
            className="w-64"
            maxLength={SCENE_TEXT_MAX_LENGTH}
            onChange={(e) => patch({ title: e.target.value === "" ? null : e.target.value })}
            size="xs"
            value={value.title ?? ""}
          />
        </FieldRow>
        <FieldRow description={t("scenes.messageHint")} label={t("scenes.messageText")}>
          <Input
            className="w-64"
            maxLength={SCENE_TEXT_MAX_LENGTH}
            onChange={(e) => patch({ message: e.target.value === "" ? null : e.target.value })}
            size="xs"
            value={value.message ?? ""}
          />
        </FieldRow>
      </FieldGroup>

      <FieldGroup title={t("scenes.groups.background")}>
        <FieldRow label={t("scenes.backgroundKind")}>
          <Select
            className="w-52"
            onChange={(next) => patchStyle({ background: backgroundOfKind(next as SceneBackground["kind"], value.style.background) })}
            options={(["solid", "gradient", "image"] as const).map((kind) => ({
              label: t(BACKGROUND_LABEL[kind]),
              value: kind,
            }))}
            size="xs"
            value={value.style.background.kind}
          />
        </FieldRow>

        {value.style.background.kind === "solid" ? (
          <FieldRow label={t("scenes.backgroundColor")}>
            <ColorField
              label={t("scenes.backgroundColor")}
              onChange={(color) => patchStyle({ background: { kind: "solid", color } })}
              value={value.style.background.color}
            />
          </FieldRow>
        ) : null}

        {value.style.background.kind === "gradient" ? (
          <>
            <FieldRow label={t("scenes.gradientFrom")}>
              <ColorField
                label={t("scenes.gradientFrom")}
                onChange={(from) =>
                  patchStyle({ background: { ...(value.style.background as Extract<SceneBackground, { kind: "gradient" }>), from } })
                }
                value={value.style.background.from}
              />
            </FieldRow>
            <FieldRow label={t("scenes.gradientTo")}>
              <ColorField
                label={t("scenes.gradientTo")}
                onChange={(to) =>
                  patchStyle({ background: { ...(value.style.background as Extract<SceneBackground, { kind: "gradient" }>), to } })
                }
                value={value.style.background.to}
              />
            </FieldRow>
            <FieldRow label={t("scenes.gradientDirection")}>
              <Select
                className="w-52"
                onChange={(direction) =>
                  patchStyle({
                    background: {
                      ...(value.style.background as Extract<SceneBackground, { kind: "gradient" }>),
                      direction: direction as (typeof GRADIENT_DIRECTIONS)[number],
                    },
                  })
                }
                options={GRADIENT_DIRECTIONS.map((direction) => ({
                  label: t(GRADIENT_LABEL[direction]),
                  value: direction,
                }))}
                size="xs"
                value={value.style.background.direction}
              />
            </FieldRow>
          </>
        ) : null}

        {value.style.background.kind === "image" ? (
          <>
            <FieldRow description={t("scenes.imageHint")} label={t("scenes.image")}>
              <Select
                className="w-52"
                onChange={(assetId) =>
                  patchStyle({
                    background: {
                      ...(value.style.background as Extract<SceneBackground, { kind: "image" }>),
                      assetId: Number(assetId),
                    },
                  })
                }
                options={imageAssets.map((asset) => ({ label: asset.name, value: String(asset.id) }))}
                placeholder={t("scenes.imagePlaceholder")}
                size="xs"
                value={String(value.style.background.assetId)}
              />
              <Button loading={addingImages} onClick={onAddImages} size="xs" variant="outline">
                <Icon name="add" />
                {t("scenes.addImage")}
              </Button>
            </FieldRow>
            <FieldRow label={t("scenes.fit")}>
              <Select
                className="w-52"
                onChange={(fit) =>
                  patchStyle({
                    background: {
                      ...(value.style.background as Extract<SceneBackground, { kind: "image" }>),
                      fit: fit as (typeof BACKGROUND_FITS)[number],
                    },
                  })
                }
                options={BACKGROUND_FITS.map((fit) => ({ label: t(FIT_LABEL[fit]), value: fit }))}
                size="xs"
                value={value.style.background.fit}
              />
            </FieldRow>
          </>
        ) : null}
      </FieldGroup>

      <FieldGroup title={t("scenes.groups.typography")}>
        <FieldRow description={t("scenes.fontHint")} label={t("scenes.font")}>
          <Select
            className="w-64"
            onChange={(family) => patchStyle({ fontFamily: family === APP_FONT ? null : family })}
            options={fontOptions}
            size="xs"
            value={value.style.fontFamily ?? APP_FONT}
          />
        </FieldRow>
        {fonts.status === "unavailable" ? (
          <div className="px-4 py-3">
            <Callout tone="warning">{t("scenes.fontsUnavailable")}</Callout>
          </div>
        ) : null}
        <FieldRow label={t("scenes.verticalAlign")}>
          <Select
            className="w-52"
            onChange={(align) => patchStyle({ verticalAlign: align as SceneStyle["verticalAlign"] })}
            options={SCENE_VERTICAL_ALIGNS.map((align) => ({ label: t(ALIGN_LABEL[align]), value: align }))}
            size="xs"
            value={value.style.verticalAlign}
          />
        </FieldRow>
      </FieldGroup>

      <TextStyleGroup
        onChange={(next) => patchStyle({ value: next })}
        t={t}
        title={t("scenes.groups.number")}
        value={value.style.value}
      />
      <TextStyleGroup
        onChange={(next) => patchStyle({ title: next })}
        t={t}
        title={t("scenes.groups.titleLine")}
        value={value.style.title}
      />
      <TextStyleGroup
        onChange={(next) => patchStyle({ message: next })}
        t={t}
        title={t("scenes.groups.messageLine")}
        value={value.style.message}
      />

      {hasCountdown(value.tool) ? (
        <FieldGroup title={t("scenes.groups.triggers")}>
          <FieldRow description={t("scenes.triggersHint")} label={t("scenes.triggersEnabled")}>
            <Switch
              checked={value.style.triggers !== null}
              onChange={(e) =>
                patchStyle({
                  triggers: e.target.checked
                    ? { warningAtMs: 60_000, warningColor: "#cd4900", endColor: "#d0021b" }
                    : null,
                })
              }
            />
          </FieldRow>
          {value.style.triggers !== null ? (
            <>
              <FieldRow description={t("scenes.warningAtHint")} label={t("scenes.warningAt")}>
                <NumericTextField
                  format={formatDuration}
                  onCommit={(warningAtMs) =>
                    patchStyle({ triggers: { ...value.style.triggers!, warningAtMs } })
                  }
                  parse={(text) => {
                    const ms = parseDuration(text);
                    return ms !== null && ms >= 0 && ms <= 3_600_000 ? ms : null;
                  }}
                  value={value.style.triggers.warningAtMs}
                />
              </FieldRow>
              <FieldRow label={t("scenes.warningColor")}>
                <ColorField
                  label={t("scenes.warningColor")}
                  onChange={(warningColor) => patchStyle({ triggers: { ...value.style.triggers!, warningColor } })}
                  value={value.style.triggers.warningColor}
                />
              </FieldRow>
              <FieldRow label={t("scenes.endColor")}>
                <ColorField
                  label={t("scenes.endColor")}
                  onChange={(endColor) => patchStyle({ triggers: { ...value.style.triggers!, endColor } })}
                  value={value.style.triggers.endColor}
                />
              </FieldRow>
            </>
          ) : null}
        </FieldGroup>
      ) : null}
    </div>
  );
}

/** Keeps the fields the previous background kind shared, so switching from a
 *  solid to a gradient and back does not lose the colour the operator picked. */
function backgroundOfKind(kind: SceneBackground["kind"], current: SceneBackground): SceneBackground {
  if (kind === current.kind) return current;
  switch (kind) {
    case "solid":
      return { kind: "solid", color: current.kind === "gradient" ? current.from : "#04132b" };
    case "gradient":
      return {
        kind: "gradient",
        from: current.kind === "solid" ? current.color : "#04132b",
        to: "#2f557f",
        direction: "to-bottom",
      };
    case "image":
      // `0` is not a valid asset id and never matches a row, which is exactly
      // right: the scene has no image yet, and the `<Select>` shows its
      // placeholder until one is chosen. The save button is what refuses it.
      return { kind: "image", assetId: 0, fit: "cover" };
  }
}

/** The four knobs every text role has. One component for all three, so the
 *  number, the title and the message can never drift apart. */
function TextStyleGroup({
  onChange,
  t,
  title,
  value,
}: {
  onChange: (next: SceneTextStyle) => void;
  t: Translate;
  title: string;
  value: SceneTextStyle;
}) {
  return (
    <FieldGroup title={title}>
      <FieldRow description={t("scenes.sizeHint")} label={t("scenes.size")}>
        <input
          aria-label={t("scenes.size")}
          className="w-40 accent-primary"
          max={SCENE_TEXT_MAX_CQW}
          min={SCENE_TEXT_MIN_CQW}
          onChange={(e) => onChange({ ...value, sizeCqw: Number(e.target.value) })}
          step={0.5}
          type="range"
          value={value.sizeCqw}
        />
        <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{value.sizeCqw}</span>
      </FieldRow>
      <FieldRow label={t("scenes.color")}>
        <ColorField label={t("scenes.color")} onChange={(color) => onChange({ ...value, color })} value={value.color} />
      </FieldRow>
      <FieldRow label={t("scenes.weight")}>
        <Select
          className="w-40"
          onChange={(weight) => onChange({ ...value, weight: Number(weight) as SceneFontWeight })}
          options={SCENE_FONT_WEIGHTS.map((weight) => ({ label: t(WEIGHT_LABEL[weight]), value: String(weight) }))}
          size="xs"
          value={String(value.weight)}
        />
      </FieldRow>
      <FieldRow description={t("scenes.shadowHint")} label={t("scenes.shadow")}>
        <Switch checked={value.shadow} onChange={(e) => onChange({ ...value, shadow: e.target.checked })} />
      </FieldRow>
    </FieldGroup>
  );
}

/**
 * A number the operator types as text (a duration, a time of day).
 *
 * The local draft is what makes it usable: committing on every keystroke would
 * turn `"10:00"` into one minute the instant `"1"` was typed, and then
 * re-format the field under the cursor. So the draft is free text while it has
 * focus, only a value that parses is committed, and blurring snaps back to the
 * canonical formatting of whatever was last committed.
 */
function NumericTextField({
  format,
  onCommit,
  parse,
  value,
}: {
  format: (value: number) => string;
  onCommit: (value: number) => void;
  parse: (text: string) => number | null;
  value: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? format(value);
  const invalid = draft !== null && parse(draft) === null;

  return (
    <Input
      aria-invalid={invalid || undefined}
      className="w-24 text-center tabular-nums"
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parse(e.target.value);
        if (parsed !== null) onCommit(parsed);
      }}
      size="xs"
      value={text}
    />
  );
}
