#!/bin/bash
#
# This assumes all of the OS-level configuration has been completed and git repo has already been cloned
#
# This script should be run from the repo's deployment directory
# cd deployment
# ./build-s3-dist.sh source-bucket-base-name trademarked-solution-name version-code
#
# Paramenters:
#  - source-bucket-base-name: Name for the S3 bucket location where the template will source the Lambda
#    code from. The template will append '-[region_name]' to this bucket name.
#    For example: ./build-s3-dist.sh solutions my-solution v1.0.0
#    The template will then expect the source code to be located in the solutions-[region_name] bucket
#
#  - trademarked-solution-name: name of the solution for consistency
#
#  - version-code: version of the package

# Check to see if input has been provided:
if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "Please provide the base source bucket name, trademark approved solution name and version where the lambda code will eventually reside."
    echo "For example: ./build-s3-dist.sh solutions trademarked-solution-name v1.0.0"
    exit 1
fi

set -e

# Get reference for all important folders
template_dir="$PWD"
template_dist_dir="$template_dir/global-s3-assets"
build_dist_dir="$template_dir/regional-s3-assets"
source_dir="$template_dir/../source"

echo "------------------------------------------------------------------------------"
echo "Rebuild distribution"
echo "------------------------------------------------------------------------------"
rm -rf $template_dist_dir
mkdir -p $template_dist_dir
rm -rf $build_dist_dir
mkdir -p $build_dist_dir

echo "------------------------------------------------------------------------------"
echo "CloudFormation Template"
echo "------------------------------------------------------------------------------"
cp $template_dir/*.yaml $template_dist_dir/

replace="s/%%BUCKET_NAME%%/$1/g"
echo "sed -i -e $replace"
sed -i -e $replace $template_dist_dir/*.yaml

replace="s/%%SOLUTION_NAME%%/$2/g"
echo "sed -i -e $replace"
sed -i -e $replace $template_dist_dir/*.yaml

replace="s/%%VERSION%%/$3/g"
echo "sed -i -e $replace"
sed -i -e $replace $template_dist_dir/*.yaml

cp $template_dist_dir/*.yaml $build_dist_dir/

echo "------------------------------------------------------------------------------"
echo "Package the image-handler code"
echo "------------------------------------------------------------------------------"
cd $source_dir/image-handler
npm install
npm run build
cp dist/image-handler.zip $build_dist_dir/image-handler.zip

# echo "------------------------------------------------------------------------------"
# echo "Package the demo-ui assets"
# echo "------------------------------------------------------------------------------"
# mkdir $build_dist_dir/demo-ui/
# cp -r $source_dir/demo-ui/** $build_dist_dir/demo-ui/

# echo "------------------------------------------------------------------------------"
# echo "Package the custom-resource code"
# echo "------------------------------------------------------------------------------"
# cd $source_dir/custom-resource
# npm install
# npm run build
# cp dist/custom-resource.zip $build_dist_dir/custom-resource.zip

# echo "------------------------------------------------------------------------------"
# echo "Generate the demo-ui manifest document"
# echo "------------------------------------------------------------------------------"
# cd $template_dir/manifest-generator
# npm install
# node app.js --target ../../source/demo-ui --output $build_dist_dir/demo-ui-manifest.json
