#!/bin/bash

echo "------------------------------------------------------------------------------"
echo "Setup the dist folder"
echo "------------------------------------------------------------------------------"
rm -r dist 
mkdir dist
cd dist
#mkdir demo-ui
cd ..

echo "------------------------------------------------------------------------------"
echo "Copy in the template"
echo "------------------------------------------------------------------------------"
cp *.yaml dist/ 
 
replace="s/%%BUCKET_NAME%%/$1/g" 
sed -i -e $replace dist/*.yaml
 
#replace="s/%%TEMPLATE_BUCKET%%/$2/g" 
#sed -i '' -e $replace dist/*.template 
 
replace="s/%%VERSION%%/$2/g" 
sed -i -e $replace dist/*.yaml 
 
cd ../source 

echo "------------------------------------------------------------------------------"
echo "Package the image-handler code"
echo "------------------------------------------------------------------------------"
cd image-handler
npm install 
npm run build 
cp dist/image-handler.zip ../../deployment/dist/image-handler.zip 
cd ..

#echo "------------------------------------------------------------------------------"
#echo "Package the demo-ui assets"
#echo "------------------------------------------------------------------------------"

#cp -r ./demo-ui/** ../deployment/dist/demo-ui

# echo "------------------------------------------------------------------------------"
# echo "Package the custom-resource code"
# echo "------------------------------------------------------------------------------"
# cd custom-resource
# npm install 
# npm run build 
# cp dist/custom-resource.zip ../../deployment/dist/custom-resource.zip 

# echo "------------------------------------------------------------------------------"
# echo "Generate the demo-ui manifest document"
# echo "------------------------------------------------------------------------------"
# cd ../../deployment/manifest-generator
# npm install
# node app.js --target ../../source/demo-ui --output ../dist/demo-ui-manifest.json