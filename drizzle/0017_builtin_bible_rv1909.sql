-- The bundled bible was always the RV1909 text, shipped as «Reina-Valera 1960». Only the untouched
-- default is renamed: a name the operator chose is theirs (see `BUILTIN_BIBLE_CODE`).
UPDATE `bible_versions` SET `name` = 'Reina-Valera 1909' WHERE `code` = 'rv1960' AND `name` = 'Reina-Valera 1960';
