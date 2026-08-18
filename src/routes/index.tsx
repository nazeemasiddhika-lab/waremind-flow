import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Warehouse Operations & Order Fulfillment System — AI Warehouse Command Center" },
      {
        name: "description",
        content:
          "Predict. Decide. Fulfill. Smart Warehouse Operations & Order Fulfillment System is an AI warehouse command center with predictive allocation, bottleneck detection and live fulfillment control.",
      },
      { property: "og:title", content: "Smart Warehouse Operations & Order Fulfillment System — AI Warehouse Command Center" },
      {
        property: "og:description",
        content:
          "Predict. Decide. Fulfill. AI decision engine, warehouse map, priority radar and full warehouse simulation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/waremind/index.html"
      title="Smart Warehouse Operations & Order Fulfillment System — AI Warehouse Command Center"
      className="h-screen w-full border-0"
    />
  );
}
