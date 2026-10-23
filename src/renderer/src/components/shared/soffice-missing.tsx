import { useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button } from "@renderer/components/ui";
import { api } from "@renderer/lib/api";
import { recheckSoffice } from "@renderer/lib/actions/soffice";
import { useDeckStore } from "@renderer/stores/deck.store";
import { cn } from "@renderer/lib/utils";

/** The three ways out of a missing LibreOffice, the same in front of a deck and
 *  in Settings: install it, look again once it is installed, or point at it. */
export function SofficeActions({ className }: { className?: string }) {
  const t = useT();
  const locateSoffice = useDeckStore((s) => s.locateSoffice);
  const [checking, setChecking] = useState(false);

  async function recheck() {
    setChecking(true);
    try {
      await recheckSoffice();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button onClick={() => void api.deck.openSofficeDownload()} size="xs" variant="primary">
        {t("deck.noLibreOffice.download")}
      </Button>
      <Button
        loading={checking}
        loadingLabel={t("deck.noLibreOffice.checking")}
        onClick={() => void recheck()}
        size="xs"
        variant="outline"
      >
        {t("deck.noLibreOffice.recheck")}
      </Button>
      <Button onClick={() => void locateSoffice()} size="xs" variant="ghost">
        {t("deck.noLibreOffice.locate")}
      </Button>
    </div>
  );
}
