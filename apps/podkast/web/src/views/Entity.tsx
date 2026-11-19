// A show's or an episode's own page. `client:visible`: a show's page holds a chart.

import { EntityView } from "@designsystem/ui/components/entity-view";

import type { EntityData } from "@/server/page-data";
import { toModel } from "./entity-model";

export function Entity({ data }: { data: EntityData }) {
  return <EntityView model={toModel(data)} />;
}
