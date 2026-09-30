import { useSeo } from "../seo";
import GraphicsBuilder from "../components/GraphicsBuilder";

/** The graphics builder as a page, open to everyone. */
export default function GraphicPage() {
  useSeo({ title: "Generate a graphic", path: "/graphic" });
  return <GraphicsBuilder inline initial={null} />;
}
