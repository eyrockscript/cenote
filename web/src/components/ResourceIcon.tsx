import {
  BoundingBoxIcon,
  SquareIcon,
  ShieldIcon,
  PathIcon,
  GlobeIcon,
  ArrowsClockwiseIcon,
  CubeIcon,
  HardDriveIcon,
  TreeStructureIcon,
  TargetIcon,
  DatabaseIcon,
  BucketIcon,
  LightningIcon,
  ShapesIcon,
} from "@phosphor-icons/react";

const ICONS = {
  aws_vpc: BoundingBoxIcon,
  aws_subnet: SquareIcon,
  aws_security_group: ShieldIcon,
  aws_route_table: PathIcon,
  aws_internet_gateway: GlobeIcon,
  aws_nat_gateway: ArrowsClockwiseIcon,
  aws_instance: CubeIcon,
  aws_ebs_volume: HardDriveIcon,
  aws_lb: TreeStructureIcon,
  aws_lb_target_group: TargetIcon,
  aws_db_instance: DatabaseIcon,
  aws_s3_bucket: BucketIcon,
  aws_lambda_function: LightningIcon,
} as const;

const CATEGORY_TINT: Record<string, string> = {
  network: "text-sky-700 bg-sky-100/60",
  compute: "text-violet-700 bg-violet-100/60",
  storage: "text-amber-700 bg-amber-100/60",
  data: "text-rose-700 bg-rose-100/60",
};

const TYPE_TO_CATEGORY: Record<string, keyof typeof CATEGORY_TINT> = {
  aws_vpc: "network",
  aws_subnet: "network",
  aws_security_group: "network",
  aws_route_table: "network",
  aws_internet_gateway: "network",
  aws_nat_gateway: "network",
  aws_lb: "network",
  aws_lb_target_group: "network",
  aws_instance: "compute",
  aws_lambda_function: "compute",
  aws_ebs_volume: "storage",
  aws_s3_bucket: "storage",
  aws_db_instance: "data",
};

interface Props {
  type: string;
  size?: number;
  className?: string;
}

export function ResourceIcon({ type, size = 14, className = "" }: Props) {
  const Icon = (ICONS as Record<string, typeof BoundingBoxIcon>)[type] ?? ShapesIcon;
  return <Icon size={size} weight="duotone" className={className} />;
}

export function typeCategoryClass(type: string): string {
  return CATEGORY_TINT[TYPE_TO_CATEGORY[type] ?? "network"];
}

export function typeShortLabel(type: string): string {
  const map: Record<string, string> = {
    aws_vpc: "VPC",
    aws_subnet: "Subnet",
    aws_security_group: "SG",
    aws_route_table: "RT",
    aws_internet_gateway: "IGW",
    aws_nat_gateway: "NAT",
    aws_instance: "EC2",
    aws_ebs_volume: "EBS",
    aws_lb: "LB",
    aws_lb_target_group: "TG",
    aws_db_instance: "RDS",
    aws_s3_bucket: "S3",
    aws_lambda_function: "Lambda",
  };
  return map[type] ?? type.replace("aws_", "");
}
