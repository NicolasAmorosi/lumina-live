import { useState } from "react";
import { useT, type Translate } from "@renderer/lib/i18n/i18n-provider";
import { ColorField, FieldGroup, FieldRow, Input, Select, Switch, type SelectOption } from "@renderer/components/ui";
import {
  BackgroundFields,
  FontFamilyFields,
  TextStyleFields,
  VerticalAlignField,
} from "@renderer/components/shared/style-fields";
import { transitionDurationOptions, transitionStyleOptions } from "@renderer/lib/transition";
import { SCENE_NAME_MAX_LENGTH, SCENE_TEXT_MAX_LENGTH } from "@shared/scene-validators";
import { formatDuration, formatMinuteOfDay, parseDuration, parseMinuteOfDay } from "@shared/timer";
import type { SceneStyle, SceneTextStyle } from "@shared/types/scene-style";
import {
  isCountdownTool,
  TIMER_MAX_DURATION_MS,
  TIMER_MIN_DURATION_MS,
  TIMER_TOOLS,
  type TimerTool,
} from "@shared/types/timer";
import type { MediaAsset } from "@shared/types/media";
import type { TransitionStyle } from "@shared/types/transition";
import { TOOL_LABEL } from "./tool-display";
import type { SceneDraft } from "./scene-draft";

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
 * The rows that edit the parts of `SceneStyle` the Bible verse style ALSO has
 * — the background, the typeface, the vertical alignment, a text role's four
 * knobs — now come from `components/shared/style-fields.tsx`. What is left
 * here is what is genuinely a time scene's: its tool, its clock, and its end
 * state.
 *
 * Fully controlled: the modal owns the draft, so it is the modal that knows
 * whether there is anything unsaved. The two free-text numeric fields
 * (duration, time of day) keep a local draft of their own anyway, because a
 * half-typed `"1"` on the way to `"10:00"` must not be committed as one
 * minute and must not fight the operator's cursor.
 */
export function SceneForm({ addingImages, imageAssets, onAddImages, onChange, value }: SceneFormProps) {
  const t = useT();

  const patch = (next: Partial<SceneDraft>) => onChange({ ...value, ...next });
  const patchStyle = (next: Partial<SceneStyle>) => patch({ style: { ...value.style, ...next } });
  const patchConfig = (next: Partial<SceneDraft["config"]>) => patch({ config: { ...value.config, ...next } });
  const patchFormat = (next: Partial<SceneDraft["config"]["format"]>) =>
    patchConfig({ format: { ...value.config.format, ...next } });

  const toolOptions: SelectOption[] = TIMER_TOOLS.map((tool) => ({
    label: t(TOOL_LABEL[tool]),
    value: tool,
  }));

  return (
    <div className="flex flex-col gap-5">
      <FieldGroup title={t("scenes.groups.scene")}>
        <FieldRow label={t("scenes.name")}>
          <Input
            className="w-64"
            maxLength={SCENE_NAME_MAX_LENGTH}
            onChange={(e) => patch({ name: e.target.value })}
            size="md"
            value={value.name}
          />
        </FieldRow>
        <FieldRow description={t("scenes.toolHint")} label={t("scenes.tool")}>
          <Select
            className="w-52"
            onChange={(next) => patch({ tool: next as TimerTool })}
            options={toolOptions}
            size="md"
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

        {isCountdownTool(value.tool) ? (
          <FieldRow description={t("scenes.overrunHint")} label={t("scenes.overrun")}>
            <Switch
              checked={value.config.format.overrun}
              onChange={(e) => patchFormat({ overrun: e.target.checked })}
            />
          </FieldRow>
        ) : null}
      </FieldGroup>

      <FieldGroup title={t("scenes.groups.texts")}>
        <FieldRow description={t("scenes.titleHint")} label={t("scenes.titleText")}>
          <Input
            className="w-64"
            maxLength={SCENE_TEXT_MAX_LENGTH}
            onChange={(e) => patch({ title: e.target.value === "" ? null : e.target.value })}
            size="md"
            value={value.title ?? ""}
          />
        </FieldRow>
        <FieldRow description={t("scenes.messageHint")} label={t("scenes.messageText")}>
          <Input
            className="w-64"
            maxLength={SCENE_TEXT_MAX_LENGTH}
            onChange={(e) => patch({ message: e.target.value === "" ? null : e.target.value })}
            size="md"
            value={value.message ?? ""}
          />
        </FieldRow>
      </FieldGroup>

      <FieldGroup title={t("style.groups.background")}>
        <BackgroundFields
          addingImages={addingImages}
          imageAssets={imageAssets}
          onAddImages={onAddImages}
          onChange={(background) => patchStyle({ background })}
          value={value.style.background}
        />
      </FieldGroup>

      <FieldGroup title={t("style.groups.typography")}>
        <FontFamilyFields
          onChange={(fontFamily) => patchStyle({ fontFamily })}
          value={value.style.fontFamily}
        />
        <VerticalAlignField
          onChange={(verticalAlign) => patchStyle({ verticalAlign })}
          value={value.style.verticalAlign}
        />
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

      {/* Everything that happens when the count runs out, in one group: the
          text that replaces the line below, how that text is drawn, and what
          disappears. Only a countdown has an end, so a clock and a stopwatch
          never see it. */}
      {isCountdownTool(value.tool) ? (
        <FieldGroup title={t("scenes.groups.end")}>
          <FieldRow description={t("scenes.endMessageHint")} label={t("scenes.endMessage")}>
            <Input
              className="w-64"
              maxLength={SCENE_TEXT_MAX_LENGTH}
              onChange={(e) => patchConfig({ endMessage: e.target.value === "" ? null : e.target.value })}
              size="md"
              value={value.config.endMessage ?? ""}
            />
          </FieldRow>
          <TextStyleFields
            onChange={(message) => patchStyle({ end: { ...value.style.end, message } })}
            t={t}
            value={value.style.end.message}
          />
          <FieldRow description={t("scenes.hideValueHint")} label={t("scenes.hideValue")}>
            <Switch
              checked={value.style.end.hideValue}
              onChange={(e) => patchStyle({ end: { ...value.style.end, hideValue: e.target.checked } })}
            />
          </FieldRow>
          <FieldRow description={t("scenes.hideTitleHint")} label={t("scenes.hideTitle")}>
            <Switch
              checked={value.style.end.hideTitle}
              onChange={(e) => patchStyle({ end: { ...value.style.end, hideTitle: e.target.checked } })}
            />
          </FieldRow>
          {/* Last in the group on purpose: it is not one more thing that
              changes at zero, it is HOW everything above it changes. */}
          <FieldRow description={t("scenes.endTransitionHint")} label={t("scenes.endTransition")}>
            <Select
              className="w-52"
              onChange={(style) =>
                patchStyle({
                  end: {
                    ...value.style.end,
                    transition: { ...value.style.end.transition, style: style as TransitionStyle },
                  },
                })
              }
              options={transitionStyleOptions(t)}
              size="md"
              value={value.style.end.transition.style}
            />
          </FieldRow>
          <FieldRow description={t("scenes.endTransitionDurationHint")} label={t("scenes.endTransitionDuration")}>
            <Select
              className="w-40"
              disabled={value.style.end.transition.style === "none"}
              onChange={(durationMs) =>
                patchStyle({
                  end: {
                    ...value.style.end,
                    transition: { ...value.style.end.transition, durationMs: Number(durationMs) },
                  },
                })
              }
              options={transitionDurationOptions(t)}
              size="md"
              value={String(value.style.end.transition.durationMs)}
            />
          </FieldRow>
        </FieldGroup>
      ) : null}

      {isCountdownTool(value.tool) ? (
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
                  size="md"
                  value={value.style.triggers.warningColor}
                />
              </FieldRow>
              <FieldRow label={t("scenes.endColor")}>
                <ColorField
                  label={t("scenes.endColor")}
                  onChange={(endColor) => patchStyle({ triggers: { ...value.style.triggers!, endColor } })}
                  size="md"
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

/** A whole group that is nothing but one text role's four knobs — the number,
 *  the title and the message, so they can never drift apart. */
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
      <TextStyleFields onChange={onChange} t={t} value={value} />
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
      size="md"
      value={text}
    />
  );
}
