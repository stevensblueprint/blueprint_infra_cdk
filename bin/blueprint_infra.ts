#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BlueprintInfraStack } from "../lib/blueprint_infra-stack";
import { props } from "../config/config";

const app = new cdk.App();
new BlueprintInfraStack(app, "blueprint-infra-stack", props);
