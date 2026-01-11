import { SSTConfig } from "sst";
import { ConanServerStack } from "./stacks/ConanServerStack";

export default {
  config(_input) {
    return {
      name: "serverless-conan",
      region: "ap-east-1", // 香港区域，您可以根据需要修改
    };
  },
  stacks(app) {
    app.stack(ConanServerStack);
  },
} satisfies SSTConfig;
