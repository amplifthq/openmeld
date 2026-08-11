import { Section, Text } from "@react-email/components";
import {
  logoAsciiLine,
  logoAsciiTable,
  logoContainer,
  logoSubtitle,
} from "./styles";

const OPENMELD_EMAIL_LOGO_LINES = [
  " ██████╗ ██████╗ ███████╗███╗   ██╗███╗   ███╗███████╗██╗     ██████╗",
  "██╔═══██╗██╔══██╗██╔════╝████╗  ██║████╗ ████║██╔════╝██║     ██╔══██╗",
  "██║   ██║██████╔╝█████╗  ██╔██╗ ██║██╔████╔██║█████╗  ██║     ██║  ██║",
  "██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║╚██╔╝██║██╔══╝  ██║     ██║  ██║",
  "╚██████╔╝██║     ███████╗██║ ╚████║██║ ╚═╝ ██║███████╗███████╗██████╔╝",
  " ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚═╝     ╚═╝╚══════╝╚══════╝╚═════╝ ",
] as const;

const OPENMELD_EMAIL_LOGO_COLORS = [
  "#bcbcbc",
  "#b6b6b6",
  "#b0b0b0",
  "#aaaaaa",
  "#a4a4a4",
  "#9e9e9e",
] as const;
const DEFAULT_LOGO_COLOR = "#bcbcbc";

type OpenMeldEmailLogoProps = {
  brandName: string;
};

function resolveLogoLineColor(index: number): string {
  const lastIndex = OPENMELD_EMAIL_LOGO_COLORS.length - 1;
  return (
    OPENMELD_EMAIL_LOGO_COLORS[Math.min(index, lastIndex)] ?? DEFAULT_LOGO_COLOR
  );
}

export function OpenMeldEmailLogo({ brandName }: OpenMeldEmailLogoProps) {
  return (
    <Section style={logoContainer}>
      <table
        align="center"
        border={0}
        cellPadding={0}
        cellSpacing={0}
        role="presentation"
        style={logoAsciiTable}
      >
        <tbody>
          {OPENMELD_EMAIL_LOGO_LINES.map((line, index) => (
            <tr key={line}>
              <td
                style={{ ...logoAsciiLine, color: resolveLogoLineColor(index) }}
              >
                {line}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Text style={logoSubtitle}>{brandName}</Text>
    </Section>
  );
}
