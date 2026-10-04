import { createContext } from "react";

/** Portalled child overlays belong to their sheet, including on phones. */
export const OptionsSheetOwner = createContext<string | undefined>(undefined);
