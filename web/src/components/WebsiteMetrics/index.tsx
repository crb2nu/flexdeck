import { Component } from "solid-js";
import PageHeader from "../shared/PageHeader";
import PageScrollBody from "../shared/PageScrollBody";
import TrafficReport from "../Metrics/TrafficReport";

const WebsiteMetrics: Component = () => {
  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="Website"
        accent=" Metrics"
        subtitle="Public ingress traffic, page-view telemetry, tracking health, and automated reliability notes."
      />

      <PageScrollBody contentClass="gap-4">
        <TrafficReport />
      </PageScrollBody>
    </div>
  );
};

export default WebsiteMetrics;
