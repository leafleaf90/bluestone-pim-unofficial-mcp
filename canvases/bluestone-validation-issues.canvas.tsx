import {
  Card,
  CardBody,
  CardHeader,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Text,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type IssueKind = "CLA" | "VLA" | "Other";

type Issue = {
  id: string;
  product: string;
  attributeName: string;
  kind: IssueKind;
  summary: string;
};

const SAMPLE_ISSUES: Issue[] = [
  {
    id: "1",
    product: "T-shirt Green / M",
    attributeName: "Brand",
    kind: "CLA",
    summary: "Product value does not match the locked category level attribute",
  },
  {
    id: "2",
    product: "T-shirt Green / M",
    attributeName: "Material",
    kind: "CLA",
    summary: "Mandatory category level attribute has no value on the product",
  },
  {
    id: "3",
    product: "T-shirt Green / M",
    attributeName: "Color",
    kind: "VLA",
    summary: "Variant value does not match the locked variant group value",
  },
  {
    id: "4",
    product: "Hoodie Blue / L",
    attributeName: "Weight",
    kind: "Other",
    summary: "Value fails attribute definition restrictions",
  },
];

const KIND_TONE: Record<IssueKind, "info" | "accent" | "neutral"> = {
  CLA: "info",
  VLA: "accent",
  Other: "neutral",
};

const FILTERS = ["All", "CLA", "VLA", "Other"] as const;

export default function BluestoneValidationIssuesCanvas() {
  const theme = useHostTheme();
  const [filter, setFilter] = useCanvasState<(typeof FILTERS)[number]>("filter", "All");

  const claCount = SAMPLE_ISSUES.filter((issue) => issue.kind === "CLA").length;
  const vlaCount = SAMPLE_ISSUES.filter((issue) => issue.kind === "VLA").length;
  const otherCount = SAMPLE_ISSUES.filter((issue) => issue.kind === "Other").length;
  const filtered =
    filter === "All"
      ? SAMPLE_ISSUES
      : SAMPLE_ISSUES.filter((issue) => issue.kind === filter);

  return (
    <Stack gap={24} style={{ padding: 24, background: theme.colors.background.primary }}>
      <Stack gap={8}>
        <H1>Product validation issues</H1>
        <Text color={theme.colors.text.secondary}>
          Reference layout for get_product_validation_issues and list_product_validation_issues
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat label="Total issues" value={String(SAMPLE_ISSUES.length)} />
        <Stat label="CLA issues" value={String(claCount)} tone="info" />
        <Stat label="VLA issues" value={String(vlaCount)} tone="accent" />
        <Stat label="Other issues" value={String(otherCount)} />
      </Grid>

      <Row gap={8} wrap>
        {FILTERS.map((item) => (
          <Pill
            key={item}
            tone={filter === item ? "accent" : "neutral"}
            onClick={() => setFilter(item)}
          >
            {item}
          </Pill>
        ))}
      </Row>

      <Stack gap={12}>
        <H2>Issues</H2>
        <Grid columns={1} gap={12}>
          {filtered.map((issue) => (
            <Card key={issue.id} variant="outline">
              <CardHeader
                title={issue.attributeName}
                subtitle={issue.product}
                trailing={<Pill tone={KIND_TONE[issue.kind]}>{issue.kind}</Pill>}
              />
              <CardBody>
                <Text>{issue.summary}</Text>
              </CardBody>
            </Card>
          ))}
        </Grid>
      </Stack>

      <Stack gap={4}>
        <H3>Layout notes</H3>
        <Text color={theme.colors.text.secondary}>
          Populate from tool JSON: issueCount, issuesByKind, issues[], and products[] for bulk
          results. Keep chat to a short summary and link here when presentationHint.preferCanvas
          is true.
        </Text>
      </Stack>
    </Stack>
  );
}
